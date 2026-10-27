/**
 * Shared rule predicates. Both intent validation (game.ts) and the
 * `allowed` block of a PlayerView (view.ts) use these, so the UI never offers
 * an action the engine would reject.
 */
import { ROLES } from './roles.ts';
import type { GameState, PhaseKind, PlayerId, PlayerState } from './types.ts';

export const CHAT_MAX = 300;
export const WILL_MAX = 1000;
export const DEATH_NOTE_MAX = 200;

const OPEN_DAY_CHAT: PhaseKind[] = ['discussion', 'voting', 'judgment'];
const SPEAKER_PHASES: PhaseKind[] = ['defense', 'lastWords'];
const WHISPER_PHASES: PhaseKind[] = ['discussion', 'voting', 'judgment'];
const REVEAL_PHASES: PhaseKind[] = ['discussion', 'voting', 'defense', 'judgment'];
const ALL_READY_PHASES: PhaseKind[] = ['reveal', 'discussion', 'night'];

export function isMafia(p: PlayerState): boolean {
  return ROLES[p.role].faction === 'mafia';
}

export function living(s: GameState): PlayerState[] {
  return s.players.filter((p) => p.alive);
}

export function voteWeight(p: PlayerState): number {
  return p.magistrateRevealed && p.role === 'magistrate' ? 3 : 1;
}

/** Weighted votes needed to put someone on trial: a majority of living players. */
export function voteThreshold(s: GameState): number {
  return Math.floor(living(s).length / 2) + 1;
}

export function tallyFor(s: GameState, target: PlayerId): number {
  let total = 0;
  for (const [voter, t] of Object.entries(s.votes)) {
    if (t !== target) continue;
    const v = s.players.find((p) => p.id === voter);
    if (v?.alive) total += voteWeight(v);
  }
  return total;
}

export function chatChannels(s: GameState, p: PlayerState): ('public' | 'mafia' | 'dead')[] {
  const kind = s.phase.kind;
  if (kind === 'ended') return ['public'];
  if (!p.alive) return ['dead'];
  const out: ('public' | 'mafia' | 'dead')[] = [];
  if (OPEN_DAY_CHAT.includes(kind)) out.push('public');
  if (SPEAKER_PHASES.includes(kind) && s.trial?.defendant === p.id) out.push('public');
  if (kind === 'night' && isMafia(p)) out.push('mafia');
  if (kind === 'night' && ROLES[p.role].hearsDead) out.push('dead');
  return out;
}

export function whisperTargets(s: GameState, p: PlayerState): PlayerId[] {
  if (!s.config.options.whispers || !p.alive || !WHISPER_PHASES.includes(s.phase.kind)) return [];
  return s.players.filter((o) => o.alive && o.id !== p.id).map((o) => o.id);
}

export function voteTargets(s: GameState, p: PlayerState): PlayerId[] {
  if (s.phase.kind !== 'voting' || !p.alive) return [];
  return s.players.filter((o) => o.alive && o.id !== p.id).map((o) => o.id);
}

export function canJudge(s: GameState, p: PlayerState): boolean {
  return s.phase.kind === 'judgment' && p.alive && s.trial !== null && s.trial.defendant !== p.id;
}

export function judgmentVoters(s: GameState): PlayerState[] {
  return s.players.filter((p) => canJudge(s, p));
}

/** Night ability usable tonight (ignores targets). */
export function canActTonight(s: GameState, p: PlayerState): boolean {
  const ability = ROLES[p.role].night;
  if (!ability || !p.alive || s.phase.kind !== 'night') return false;
  if (p.usesLeft !== null && p.usesLeft <= 0) return false;
  if (ability.firstNight !== undefined && s.phase.day < ability.firstNight) return false;
  return true;
}

export function nightTargets(s: GameState, p: PlayerState): PlayerId[] {
  if (!canActTonight(s, p)) return [];
  const ability = ROLES[p.role].night;
  if (!ability) return [];
  const alive = s.players.filter((o) => o.alive);
  switch (ability.target) {
    case 'self':
      return [p.id];
    case 'other':
      return alive.filter((o) => o.id !== p.id).map((o) => o.id);
    case 'any':
      return alive
        .filter((o) => o.id !== p.id || p.selfUsesLeft === null || p.selfUsesLeft > 0)
        .map((o) => o.id);
    case 'nonMafia':
      return alive.filter((o) => !isMafia(o)).map((o) => o.id);
  }
}

export function canReveal(s: GameState, p: PlayerState): boolean {
  return (
    p.alive &&
    p.role === 'magistrate' &&
    !p.magistrateRevealed &&
    REVEAL_PHASES.includes(s.phase.kind)
  );
}

export function canReady(s: GameState, p: PlayerState): boolean {
  if (!p.alive) return false;
  if (ALL_READY_PHASES.includes(s.phase.kind)) return true;
  return SPEAKER_PHASES.includes(s.phase.kind) && s.trial?.defendant === p.id;
}

/** True once everyone whose ready matters has pressed it. */
export function everyoneReady(s: GameState): boolean {
  const kind = s.phase.kind;
  if (ALL_READY_PHASES.includes(kind)) return living(s).every((p) => s.ready.includes(p.id));
  if (SPEAKER_PHASES.includes(kind)) return !!s.trial && s.ready.includes(s.trial.defendant);
  return false;
}

export function canEditWill(s: GameState, p: PlayerState): boolean {
  return p.alive && s.phase.kind !== 'ended';
}

export function canEditDeathNote(s: GameState, p: PlayerState): boolean {
  return canEditWill(s, p) && ROLES[p.role].deathNote;
}

function stripControls(text: string, keepNewlines: boolean): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const control = c < 0x20 || c === 0x7f;
    out += control && !(keepNewlines && ch === '\n') ? ' ' : ch;
  }
  return out;
}

/** Collapse whitespace and strip control characters from a chat line. */
export function cleanLine(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return stripControls(text, false).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Like `cleanLine` but keeps line breaks (wills and death notes). */
export function cleanBlock(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return stripControls(text.replace(/\r\n?/g, '\n'), true)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * During voting, when a vote majority may first start a trial (see
 * `Timers.trialDelay`). Null outside voting.
 */
export function trialOpensAt(s: GameState): number | null {
  if (s.phase.kind !== 'voting' || s.phase.endsAt === null) return null;
  const t = s.config.timers;
  const delay = t.trialDelay ?? Math.round(t.voting * 0.35);
  const length = s.phase.endsAt - s.phase.startedAt;
  return s.phase.startedAt + Math.max(0, Math.min(delay, length / 2));
}

/** The player the current votes would put on trial: most votes, seat order breaks ties. */
export function majorityTarget(s: GameState): PlayerId | null {
  const need = voteThreshold(s);
  let best: PlayerId | null = null;
  let bestTally = 0;
  for (const p of s.players) {
    const n = tallyFor(s, p.id);
    if (n >= need && n > bestTally) {
      best = p.id;
      bestTally = n;
    }
  }
  return best;
}
