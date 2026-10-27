# src/engine

Owner: rules engine and bots agent.

Pure, deterministic, JSON-serializable rules engine with seeded randomness. No DOM, no networking. The public interface lives in `types.ts`: `createGame(config, seed)`, `applyIntent(state, playerId, intent, now)`, `tick(state, now)`, and `viewFor(state, playerId)`.
