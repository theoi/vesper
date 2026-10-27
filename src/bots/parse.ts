/**
 * Best-effort reading of free-text chat (humans send no speech acts).
 * Turns a line into claims, accusations, defenses, and questions.
 */
import { ROLES, ROLE_IDS } from '../engine/roles.ts';
import type { ClaimedResult, PlayerId, PublicPlayer, RoleId, SpeechAct } from '../engine/types.ts';

const ACCUSE =
  /\b(sus|suss|suspicious|scum|scummy|mafia|syndicate|evil|liar|lying|lies|guilty|lynch|hang|execute|kill(er)?|fake|hostile|bad)\b/i;
const DEFEND =
  /\b(innocent|town|trust|clear|cleared|good|confirmed|legit|not (?:sus|mafia|syndicate|evil))\b/i;
const CLAIM_RE = new RegExp(
  String.raw`\b(?:i am|i'm|im|i’m|claim(?:ing)?|my role is|role:?)\s+(?:the\s+|a\s+|an\s+)?(${ROLE_IDS.map((r) => ROLES[r].name).join('|')})\b`,
  'i',
);

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Player ids mentioned by name in the text. */
export function mentions(text: string, players: PublicPlayer[]): PlayerId[] {
  const out: PlayerId[] = [];
  for (const p of players) {
    if (new RegExp(`(^|[^\\p{L}])${escape(p.name)}($|[^\\p{L}])`, 'iu').test(text)) out.push(p.id);
  }
  return out;
}

export function parseLine(text: string, players: PublicPlayer[], speaker: PlayerId): SpeechAct[] {
  const acts: SpeechAct[] = [];
  const named = mentions(text, players).filter((id) => id !== speaker);
  const claim = CLAIM_RE.exec(text);
  if (claim) {
    const role = ROLE_IDS.find(
      (r) => ROLES[r].name.toLowerCase() === claim[1]?.toLowerCase(),
    ) as RoleId;
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
  const question = text.includes('?');
  for (const id of named) {
    if (ACCUSE.test(text) && !/\bnot\b/i.test(text))
      acts.push({ kind: 'accuse', target: id, confidence: 0.6 });
    else if (DEFEND.test(text)) acts.push({ kind: 'defend', target: id });
    else if (question) acts.push({ kind: 'question', target: id });
  }
  if (acts.length === 0 && question) acts.push({ kind: 'question' });
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
