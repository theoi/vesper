/**
 * Vesper rules engine. Pure TypeScript: no DOM, no networking, no clock.
 *
 * Host loop sketch:
 *   let { state, events } = createGame(config, seed, Date.now());
 *   // on a client intent:   ({ state, events, error } = applyIntent(state, id, intent, Date.now()))
 *   // on a timer:           ({ state, events } = tick(state, Date.now()))  // see nextDeadline(state)
 *   // send each player:     eventsFor(events, id)  or  viewFor(state, id, { sinceSeq })
 */
export * from './types.ts';
export {
  ROLES,
  ROLE_IDS,
  FACTIONS,
  CATEGORY_NAMES,
  RANDOM_SLOT_NAMES,
  RANDOM_SLOT_ROLES,
  isRoleId,
  isRandomSlot,
  slotName,
} from './roles.ts';
export {
  PRESETS,
  presetFor,
  defaultConfig,
  validateRoleList,
  DEFAULT_TIMERS,
  FAST_TIMERS,
  DEFAULT_OPTIONS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_NAME_LENGTH,
} from './setup.ts';
export { createGame, applyIntent, tick, nextDeadline } from './game.ts';
export { viewFor, eventsFor } from './view.ts';
