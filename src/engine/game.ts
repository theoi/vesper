import type { GameConfig, GameState, Intent, IntentResult, PlayerId, StepResult } from './types.ts';

/**
 * Create a game in the `reveal` phase. Roles are dealt from `seed`.
 * Throws if the config is invalid (see `validateRoleList`).
 */
export function createGame(_config: GameConfig, _seed: number | string, _now = 0): StepResult {
  throw new Error('createGame: not implemented yet');
}

/**
 * Apply one player's intent. Invalid intents are rejected with `error` and leave
 * the state unchanged. May advance the phase (a trial majority, all ballots in,
 * everyone ready).
 */
export function applyIntent(
  _state: GameState,
  _playerId: PlayerId,
  _intent: Intent,
  _now: number,
): IntentResult {
  throw new Error('applyIntent: not implemented yet');
}

/** Advance any phases whose timers have run out by `now`. */
export function tick(_state: GameState, _now: number): StepResult {
  throw new Error('tick: not implemented yet');
}

/** When the host should call `tick` next (null once the game has ended). */
export function nextDeadline(state: GameState): number | null {
  return state.phase.endsAt;
}
