/**
 * Best-effort reading of free-text chat (humans send no speech acts).
 * Turns a line into claims, accusations, defenses, and questions.
 */
import { ROLES, ROLE_IDS } from '../engine/roles.ts';
import type { ClaimedResult, PlayerId, PublicPlayer, RoleId, SpeechAct } from '../engine/types.ts';
import type { Ask } from './types.ts';

const HOSTILE_ROLES = ROLE_IDS.filter((r) => ROLES[r].faction === 'mafia' || r === 'cutthroat').map(
  (r) => ROLES[r].name,
);

const ACCUSE = new RegExp(
  String.raw`\b(sus|suss|suspicious|scum|scummy|mafia|syndicate|evil|liar|lying|lies|guilty|lynch|hang|execute|kill(er)?|fake|hostile|bad|shady|sketchy|fishy|${HOSTILE_ROLES.join('|')})\b`,
  'i',
);
/** Accusations that a plain "not" check would mistake for denials. */
const DOUBT =
  /\b(doesn[’']?t add up|don[’']?t (?:buy|believe|trust)|not buying|can[’']?t trust)\b/i;
const NEGATED = /\b(not|never|isn[’']?t|aren[’']?t|wasn[’']?t|don[’']?t|dont)\b/i;
const DEFEND =
  /\b(innocent|town|trust|clear|cleared|good|confirmed|legit|not (?:sus|mafia|syndicate|evil))\b/i;
const ROLE_ALT = ROLE_IDS.map((r) => ROLES[r].name).join('|');
const CLAIM_RE = new RegExp(
  String.raw`\b(?:i am|i'm|im|i’m|claim(?:ing)?|my role is|role:?)\s+(?:the\s+|a\s+|an\s+)?(${ROLE_ALT})\b`,
  'i',
);
/** "Augur here." */
const CLAIM_HERE = new RegExp(String.raw`(?:^|[.!;]\s*)(?:the\s+)?(${ROLE_ALT})\s+here\b`, 'i');
/** "Ada, are you Syndicate?" is a challenge, not an open question. */
const CHALLENGE = new RegExp(
  String.raw`\bare (?:you|u)\b[^?]*\b(sus|syndicate|mafia|evil|scum|lying|a liar|the killer|hostile|fake|${HOSTILE_ROLES.join('|')})\b`,
  'i',
);
/** Words that ask for something even without a question mark: "Ada, claim." */
const ASKING = /\b(role|claim|tell|explain|speak|talk|answer|share|suspect|read|thoughts)\b/i;
const ROLE_ASK = /\b(role|claim|what are (?:you|u)|who are (?:you|u)|what do (?:you|u) do)\b/i;
const SUSPECT_ASK =
  /\b(suspect|suspicions?|sus|suss|reads?|thoughts|think|opinion|who (?:is|are)|who[’']s|who should|vote for|who do (?:you|u|we|y[’']?all))\b/i;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const nameRe = (name: string) => new RegExp(`(^|[^\\p{L}])${escape(name)}($|[^\\p{L}])`, 'iu');

/** "vote Ada", "voting for Ada", "lynch Ada". */
const voteFor = (name: string) =>
  new RegExp(
    String.raw`\b(?:vote|voting|lynch|hang|execute)\s+(?:for\s+|on\s+|out\s+)?${escape(name)}\b`,
    'i',
  );

/** Player ids mentioned by name in the text. */
export function mentions(text: string, players: PublicPlayer[]): PlayerId[] {
  return players.filter((p) => nameRe(p.name).test(text)).map((p) => p.id);
}

/** What a question asks for: a role, a suspect, or anything else. */
export function askOf(text: string): Ask {
  if (ROLE_ASK.test(text)) return 'role';
  if (SUSPECT_ASK.test(text)) return 'suspect';
  return 'open';
}

/** The player a sentence speaks to: "Ada, ...", "@Ada ...", "..., Ada?", or "... you ... Ada?" */
function addressee(sentence: string, players: PublicPlayer[]): PlayerId | null {
  for (const p of players) {
    const n = escape(p.name);
    if (
      new RegExp(String.raw`^[^\p{L}@]*@?${n}\s*(?:[,:!-]|$)`, 'iu').test(sentence) ||
      new RegExp(String.raw`^[^\p{L}]*@${n}\b`, 'iu').test(sentence) ||
      new RegExp(String.raw`,\s*${n}[^\p{L}]*$`, 'iu').test(sentence) ||
      (/\b(you|your|u)\b/i.test(sentence) &&
        new RegExp(String.raw`(^|[^\p{L}])${n}\s*[?!.]*$`, 'iu').test(sentence))
    )
      return p.id;
  }
  return null;
}

function claimIn(text: string): RoleId | null {
  const m = CLAIM_RE.exec(text) ?? CLAIM_HERE.exec(text);
  if (!m) return null;
  return ROLE_IDS.find((r) => ROLES[r].name.toLowerCase() === m[1]?.toLowerCase()) ?? null;
}

export function parseLine(text: string, players: PublicPlayer[], speaker: PlayerId): SpeechAct[] {
  const acts: SpeechAct[] = [];
  const others = players.filter((p) => p.id !== speaker);
  const named = mentions(text, others);
  const role = claimIn(text);
  if (role) {
    const results: ClaimedResult[] = [];
    if (role === 'augur') {
      for (const id of named) {
        const name = players.find((p) => p.id === id)?.name ?? '';
        const near = new RegExp(`${escape(name)}[^.?!]{0,30}`, 'i').exec(text)?.[0] ?? '';
        if (ACCUSE.test(near)) results.push({ night: 0, target: id, finding: 'suspicious' });
        else if (DEFEND.test(near)) results.push({ night: 0, target: id, finding: 'clear' });
      }
    }
    acts.push(results.length > 0 ? { kind: 'claim', role, results } : { kind: 'claim', role });
    if (results.length > 0) return acts;
  }
  const add = (a: SpeechAct) => {
    const target = 'target' in a ? a.target : undefined;
    if (!acts.some((x) => x.kind === a.kind && ('target' in x ? x.target : undefined) === target))
      acts.push(a);
  };
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const ids = mentions(sentence, others);
    const to = addressee(sentence, others);
    if (sentence.includes('?')) {
      if (to && CHALLENGE.test(sentence)) add({ kind: 'accuse', target: to, confidence: 0.4 });
      else if (to) add({ kind: 'question', target: to });
      else if (ids.length > 0)
        for (const id of ids)
          add(
            ACCUSE.test(sentence) && !NEGATED.test(sentence)
              ? { kind: 'accuse', target: id, confidence: 0.3 }
              : { kind: 'question', target: id },
          );
      else add({ kind: 'question' });
      continue;
    }
    for (const id of ids) {
      const name = others.find((p) => p.id === id)?.name ?? '';
      const negated = NEGATED.test(sentence);
      if (
        DOUBT.test(sentence) ||
        (!negated && (ACCUSE.test(sentence) || voteFor(name).test(sentence)))
      )
        add({ kind: 'accuse', target: id, confidence: 0.6 });
      else if (DEFEND.test(sentence)) add({ kind: 'defend', target: id });
      else if (id === to && ASKING.test(sentence)) add({ kind: 'question', target: id });
    }
  }
  return acts;
}
/** Read results out of a will written in the bots' format or close to it. */
export function parseWill(will: string, players: PublicPlayer[]): ClaimedResult[] {
  const out: ClaimedResult[] = [];
  const byName = (n: string) =>
    players.find((p) => p.name.toLowerCase() === n.trim().toLowerCase())?.id;
  for (const line of will.split('\n')) {
    const m =
      /^\s*N(?:ight)?\s*(\d+)\s*[:-]\s*(.+?)\s*[-:–]\s*(suspicious|clear|sus|innocent)/i.exec(line);
    if (m) {
      const target = byName(m[2] ?? '');
      if (target) {
        const sus = /^sus/i.test(m[3] ?? '');
        out.push({ night: Number(m[1]), target, finding: sus ? 'suspicious' : 'clear' });
      }
      continue;
    }
    const v = /^\s*N(?:ight)?\s*(\d+)\s*[:-]\s*(.+?)\s+visited by\s+(.+)$/i.exec(line);
    if (v) {
      const target = byName(v[2] ?? '');
      const visitors = (v[3] ?? '')
        .split(/,|\band\b/)
        .map((s) => byName(s))
        .filter((x): x is string => !!x);
      if (target) out.push({ night: Number(v[1]), target, finding: 'visited', visitors });
    }
  }
  return out;
}
