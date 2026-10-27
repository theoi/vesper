import type { GameEvent, GameState, PlayerId, PlayerView, ViewOptions } from './types.ts';

/** Everything `playerId` may know right now. */
export function viewFor(
  _state: GameState,
  _playerId: PlayerId,
  _opts: ViewOptions = {},
): PlayerView {
  throw new Error('viewFor: not implemented yet');
}

/** Filter events to those `playerId` may receive. */
export function eventsFor(events: readonly GameEvent[], playerId: PlayerId): GameEvent[] {
  return events.filter((e) => e.audience === 'all' || e.audience.includes(playerId));
}
