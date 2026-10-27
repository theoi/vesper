/**
 * Guardrails for Claude's lines: clean up formatting, then reject anything that
 * changes the line's meaning, leaks a secret, or breaks character. A rejected
 * line falls back to the scripted draft.
 */
import { ROLES, ROLE_IDS } from '../../engine/roles.ts';
import type { PlayerId, PlayerView, RoleId } from '../../engine/types.ts';
import { nickname } from '../lines.ts';
import type { BotSpeech } from '../types.ts';
import { channelOf, isBluffing, lastPublicClaim, personalityOf, recentLines } from './prompt.ts';

export type GuardRule =
  | 'empty'
  | 'too-long'
  | 'meta'
  | 'foreign-role'
  | 'missing-target'
  | 'missing-role'
  | 'missing-result'
  | 'new-name'
  | 'new-accusation'
  | 'teammate-named'
  | 'syndicate-slip'
  | 'self-claim'
  | 'self-incriminate'
  | 'mourner-name';

export interface GuardContext {
  view: PlayerView;
  speech: BotSpeech;
  maxChars: number;
}

const META =
  /\b(here(?:'s|’s| is) (?:my|the|a) (?:line|message|reply|rewrite|version)|as an ai|an ai\b|ai model|language model|assistant|chatbot|anthropic|claude|system prompt|prompt|the draft|this draft|draft line|rewrite|rewritten|scripted|in character|out of character|ooc|i can(?:'|’)?t (?:help|assist)|i cannot (?:help|assist|comply)|as requested)\b/i;

/** Role names from other games in the genre; this game uses its own. */
const FOREIGN_ROLES =
  /\b(sheriff|godfather|mafioso|consigliere|consort|jailor|jailer|jester|executioner|serial killer|investigator|lookout|bodyguard|vigilante|retributionist|transporter|janitor|escort|framer|doctor|mayor|the medium|town of salem|epicmafia)\b/i;

const SLIP =
  /\b(teammates?|my (?:team|partners?|crew|boss|patron|hatchet|family)|our (?:team|crew|kill|target|boss|patron|hatchet|plan|family)|fellow syndicate|we (?:will |'ll |’ll )?(?:kill|killed|hit|take out|pick)\b)/i;

/** Words that accuse someone or report a night result about them. */
const ACCUSING =
  /\b(sus|suss|suspicious|suspect|syndicate|mafia|scum|evil|liar|lying|lies|guilty|killer|hostile|fake|shady|lynch|hang|execute|villain|culprit|wolf|chase|chasing|blame|read|clear|tended|healed|protected|guarded|saved|watched|visited|checked|investigated)\b/i;

const SELF_INCRIMINATE =
  /\b(?:i am|i'm|i’m|im|we are|we're|we’re)\s+(?:the\s+|a\s+|in the\s+)?(?:syndicate|mafia|killer|murderer|evil|scum)\b/i;

const ROLE_ALT = ROLE_IDS.map((r) => ROLES[r].name).join('|');
const SELF_CLAIM = new RegExp(
  String.raw`\b(?:i\s+am|i'm|i’m|im|i\s+was|my\s+role\s+is|i\s+claim|i(?:'m|’m|\s+am)\s+claiming)\s+(?:to\s+be\s+)?(?:the\s+|a\s+|an\s+|your\s+)?(${ROLE_ALT})\b`,
  'gi',
);

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `text` mentions `name`, allowing the bots' nickname and a short form. */
export function mentionsName(text: string, name: string): boolean {
  const forms = new Set([escape(name)]);
  if (name.length > 4) forms.add(escape(nickname(name)));
  if (name.length >= 6) forms.add(`${escape(name.slice(0, 4))}\\p{L}{0,${name.length - 4}}`);
  const re = new RegExp(`(^|[^\\p{L}])(?:${[...forms].join('|')})(?:'s|’s)?($|[^\\p{L}])`, 'iu');
  return re.test(text);
}

function mentioned(text: string, view: PlayerView): Set<PlayerId> {
  return new Set(view.players.filter((p) => mentionsName(text, p.name)).map((p) => p.id));
}

/** True when `name` is only being addressed ("Bea, ..." or "..., Bea?"), not talked about. */
function vocative(sentence: string, name: string): boolean {
  const n = escape(name);
  const lead = new RegExp(String.raw`^\W*${n}\s*[,:]`, 'i');
  const tail = new RegExp(String.raw`,\s*${n}\W*$`, 'i');
  const aside = new RegExp(String.raw`,\s*${n}\s*,`, 'i');
  return lead.test(sentence) || tail.test(sentence) || aside.test(sentence);
}

function selfClaims(text: string): RoleId[] {
  const out: RoleId[] = [];
  for (const m of text.matchAll(SELF_CLAIM)) {
    const role = ROLE_IDS.find((r) => ROLES[r].name.toLowerCase() === m[1]?.toLowerCase());
    if (role) out.push(role);
  }
  return out;
}

function hasRole(text: string, role: RoleId): boolean {
  return new RegExp(`\\b${escape(ROLES[role].name)}\\b`, 'i').test(text);
}

/**
 * Normalize a raw model reply into one chat line: first line only, no quotes,
 * labels, markdown, stage directions, or emojis, and at most `maxChars`
 * (cut at a sentence end). Returns '' when nothing usable is left.
 */
export function cleanReply(raw: string, ctx: GuardContext): string {
  const me = ctx.view.you.name;
  let t = raw.replace(/\r/g, '');
  t =
    t
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  t = t.replace(
    new RegExp(`^\\**(?:${escape(me)}|me|message|reply|line)\\**\\s*[:：]\\s*`, 'i'),
    '',
  );
  t = t.replace(/^[-*•>]\s+/, '');
  t = t.replace(/^(?:\*[^*]{1,40}\*|\([^)]{1,40}\)|\[[^\]]{1,40}\])\s*/, '');
  t = t.replace(/\*\*|__|`/g, '').replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|$|[.,!?])/g, '$1$2');
  t = t.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/#\w+/g, '');
  t = t.trim();
  for (let i = 0; i < 2; i++) {
    const m = /^(["“”'‘’])([\s\S]*)(["“”'‘’])$/.exec(t);
    if (m && m[2] && !m[2].includes(m[1] ?? '"')) t = m[2].trim();
  }
  t = t.replace(/\s{2,}/g, ' ').trim();
  if (personalityOf(ctx.speech.personality).quirks.includes('lowercase')) t = t.toLowerCase();
  if (t.length > ctx.maxChars) {
    const head = t.slice(0, ctx.maxChars);
    const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    const end = /[.!?…]$/.test(head) ? head.length : cut + 1;
    t = end > 0 ? head.slice(0, end).trim() : '';
  }
  return t;
}

/** Return the first rule the line breaks, or null when it is safe to send. */
export function checkReply(text: string, ctx: GuardContext): GuardRule | null {
  const { view, speech } = ctx;
  const draft = speech.intent.text;
  const act = speech.act;
  const channel = channelOf(speech);
  const you = view.you;
  // Secrets matter only while the speaker is alive and the game is running.
  const open =
    (channel === 'public' || channel === 'whisper') && you.alive && view.phase.kind !== 'ended';
  const name = (id: PlayerId) => view.players.find((p) => p.id === id)?.name ?? '';

  if (text.trim().length === 0) return 'empty';
  if (text.length > ctx.maxChars) return 'too-long';
  if (META.test(text) && !META.test(draft)) return 'meta';
  if (FOREIGN_ROLES.test(text) && !FOREIGN_ROLES.test(draft)) return 'foreign-role';

  // The line must still carry its speech act.
  const target = 'target' in act ? act.target : null;
  const needsTarget =
    (act.kind === 'accuse' ||
      act.kind === 'vote' ||
      act.kind === 'plan' ||
      act.kind === 'question' ||
      act.kind === 'defend') &&
    target &&
    target !== you.id;
  if (
    needsTarget &&
    target &&
    !mentionsName(text, name(target)) &&
    mentionsName(draft, name(target))
  )
    return 'missing-target';
  if (act.kind === 'claim') {
    if (!hasRole(text, act.role) && hasRole(draft, act.role)) return 'missing-role';
    for (const r of act.results ?? []) {
      if (!mentionsName(text, name(r.target)) && mentionsName(draft, name(r.target)))
        return 'missing-result';
    }
  }

  // No new players dragged in, and living Syndicate partners stay out of public talk.
  const inText = mentioned(text, view);
  const inDraft = mentioned(draft, view);
  const actIds = new Set<PlayerId>([you.id]);
  if (target) actIds.add(target);
  if (act.kind === 'claim') for (const r of act.results ?? []) actIds.add(r.target);
  if (speech.intent.type === 'whisper') actIds.add(speech.intent.to);
  const livingMates = new Set(you.teammates.filter((m) => m.alive).map((m) => m.id));
  const context = new Set<PlayerId>();
  for (const line of recentLines(view, channel, 8))
    for (const id of mentioned(line, view)) context.add(id);
  if (view.trial) context.add(view.trial.defendant);
  // Partners in their own chat, and fellow ghosts in the dead chat, are fair to name.
  if (channel === 'mafia') for (const m of you.teammates) context.add(m.id);
  if (channel === 'dead') for (const p of view.players) if (!p.alive) context.add(p.id);
  // The Mourner may overhear the dead chat, so dead Syndicate keep quiet about partners too.
  const hidePartners = open || channel === 'dead';
  const ended = view.phase.kind === 'ended';
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const addressed = (n: string) => sentences.some((s) => vocative(s, n));
  for (const id of inText) {
    if (inDraft.has(id) || actIds.has(id)) continue;
    if (hidePartners && livingMates.has(id)) return 'teammate-named';
    // Simply addressing someone ("..., Bea?") is harmless; after the game anyone may be named.
    if (!context.has(id) && !ended && !addressed(name(id))) return 'new-name';
  }
  // In the open, accusations and results may only point where the draft points, or
  // repeat results the bot has already claimed in public.
  const claimed = new Set<PlayerId>();
  for (const e of view.events) {
    if (
      e.type === 'chat' &&
      e.channel === 'public' &&
      e.from === you.id &&
      e.meta?.kind === 'claim'
    )
      for (const r of e.meta.results ?? []) claimed.add(r.target);
  }
  for (const sentence of open ? sentences : []) {
    if (!ACCUSING.test(sentence)) continue;
    for (const p of view.players) {
      if (inDraft.has(p.id) || actIds.has(p.id) || claimed.has(p.id)) continue;
      if (!mentionsName(sentence, p.name)) continue;
      if (!vocative(sentence, p.name)) return 'new-accusation';
    }
  }

  if (open) {
    if (you.teammates.length > 0 && SLIP.test(text) && !SLIP.test(draft)) return 'syndicate-slip';
    if (you.role !== 'harlequin' && SELF_INCRIMINATE.test(text) && !SELF_INCRIMINATE.test(draft))
      return 'self-incriminate';
    const allowed = new Set<RoleId>(selfClaims(draft));
    if (act.kind === 'claim') allowed.add(act.role);
    const prior = lastPublicClaim(view, you.id);
    if (prior) allowed.add(prior);
    if (!isBluffing(view) && hasRole(draft, you.role)) allowed.add(you.role);
    for (const role of selfClaims(text)) if (!allowed.has(role)) return 'self-claim';
  }

  if (channel === 'dead' && you.alive && mentionsName(text, you.name)) return 'mourner-name';
  return null;
}
