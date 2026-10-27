# src/engine

Owner: rules engine and bots agent.

Pure, deterministic, JSON-serializable rules engine with seeded randomness. No DOM, no networking, no clock: callers pass `now` in milliseconds.

Import everything from `src/engine/index.ts`. Types live in `types.ts`.

| Function                                    | Returns                     | Notes                                                                      |
| ------------------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `createGame(config, seed, now)`             | `{ state, events }`         | Deals roles from the seed; starts in `reveal`.                             |
| `applyIntent(state, playerId, intent, now)` | `{ state, events, error? }` | Rejected intents return `error` and leave the state unchanged.             |
| `tick(state, now)`                          | `{ state, events }`         | Advances phases whose timer ran out. Schedule with `nextDeadline(state)`.  |
| `viewFor(state, playerId, { sinceSeq? })`   | `PlayerView`                | Exactly what that player may know. `sinceSeq` limits `events` to new ones. |
| `eventsFor(events, playerId)`               | `GameEvent[]`               | Filters events by `audience`; use it to forward a step's events to a peer. |
| `validateRoleList(roles, playerCount)`      | `{ ok, errors, warnings }`  | For the host's custom role list.                                           |
| `presetFor(playerCount)` / `PRESETS`        | `Preset`                    | Built-in setups for 7–15 players (with fallbacks from 4 to 16).            |
| `defaultConfig(players, overrides?)`        | `GameConfig`                | Preset roles plus default timers and options.                              |

`GameState` is host-only and must never be sent to clients. Every event carries an `audience` (`'all'` or a list of player ids).
