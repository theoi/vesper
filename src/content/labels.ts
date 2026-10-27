/**
 * Player-facing words for engine terms: how deaths, game results, and night
 * outcomes read in feed lines, cards, and the curtain call. Plain data with
 * `{token}` names filled from `src/engine/roles.ts`, like the help copy.
 */
import type {
  DeathCause,
  GameResult,
  NightActionKind,
  NightOutcome,
  NightResult,
} from '../engine/types.ts';
import { fill } from './help.ts';

/** What happened to someone, after their name: "Sabine was killed by the Syndicate." */
export const DEATH_CAUSE: Record<DeathCause, string> = {
  executed: 'was executed by the town',
  mafia: fill('was killed by the {mafia}'),
  cutthroat: fill('was stabbed by the {cutthroat}'),
  reckoner: fill('was shot by a {reckoner}'),
  sentinel: fill('was struck down by a {sentinel}'),
  guarding: 'died guarding someone',
};

/**
 * Every cause of one death as a phrase to put after the name, in the order the
 * engine lists them: "was killed by the Syndicate and shot by a Reckoner".
 */
export function deathPhrase(causes: readonly DeathCause[]): string {
  const [first, ...rest] = [...new Set(causes)].map((c) => DEATH_CAUSE[c]);
  if (!first) return 'died';
  const parts = [
    first,
    ...rest.map((p) => (first.startsWith('was ') ? p.replace(/^was /, '') : p)),
  ];
  if (parts.length <= 2) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

/** The curtain call's headline for each outcome. */
export const OUTCOME_HEADLINE: Record<GameResult['outcome'], string> = {
  town: fill('The {town} prevails'),
  mafia: fill('The {mafia} prevails'),
  cutthroat: fill('The {cutthroat} stands alone'),
  draw: 'A draw',
};

/** Why the game ended, as a sentence. */
export const RESULT_REASON: Record<GameResult['reason'], string> = {
  threatsEliminated: 'Every threat to the town is gone.',
  mafiaParity: fill('The {mafia} has the numbers now.'),
  lastKillerStanding: 'One killer is left standing.',
  allDead: 'Nobody is left alive.',
  stalemate: 'Too many days and nights passed without a death.',
  dayLimit: 'The town ran out of days.',
};

/** One line for the end of the game: "The Town prevails: every threat to the town is gone." */
export function resultLine(result: Pick<GameResult, 'outcome' | 'reason'>): string {
  const why = RESULT_REASON[result.reason];
  return `${OUTCOME_HEADLINE[result.outcome]}: ${why.charAt(0).toLowerCase()}${why.slice(1)}`;
}

type SavedBy = Extract<NightResult, { kind: 'attackedSurvived' }>['savedBy'];

/** Why a player lived through an attack, after "You were attacked, but ...". */
export const SAVED_BY: Record<SavedBy, string> = {
  defense: 'you were too tough to kill',
  vest: 'your vest held',
  healed: fill('a {mender} saved your life'),
  guarded: fill('a {sentinel} fought off your attacker'),
};

/** A short label for how one night ability turned out (see `NightOutcome`). */
export const NIGHT_OUTCOME: Record<NightOutcome, string> = {
  blocked: 'distracted',
  killed: 'killed',
  survived: 'target survived',
  intercepted: fill('stopped by a {sentinel}'),
  ordered: 'ordered the kill',
  suspicious: 'read Suspicious',
  clear: 'read Clear',
  watched: 'watched',
  saved: 'saved a life',
  fought: 'fought off an attacker',
  quiet: 'a quiet night',
  distracted: 'kept their target busy',
  resisted: 'target resisted',
  framed: 'framed',
  embalmed: 'embalmed',
  armored: 'wore the vest',
};

/** The verb for each night ability: "Rook wants to kill Bram", "You will mark Cal tonight". */
export const NIGHT_VERB: Record<NightActionKind, string> = {
  investigate: 'read',
  watch: 'watch',
  heal: 'tend',
  guard: 'guard',
  shoot: 'shoot',
  block: 'distract',
  kill: 'kill',
  frame: 'mark',
  embalm: 'embalm',
  stab: 'stab',
  vest: 'wear the vest for',
};
