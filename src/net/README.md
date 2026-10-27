# src/net

Owner: platform and online play agent.

Host-authoritative online rooms over WebRTC. The host's browser runs the engine and bots. Remote players send intents and receive only their own `PlayerView` plus the events addressed to them, so no other player's secrets reach their browser.

## Pieces

- `host.ts`: `HostSession`. Lobby (seats, bots, settings, kick), game loop (`tick` at `nextDeadline`, bots via `decideBot` at `wakeAt` or when they have new events), per-player view streaming, rejoin by token, heartbeats, and an intent rate limit. Optional `rewriteSpeech` hook for the Claude chat layer: it may replace a bot line's text; failures and timeouts fall back to the scripted line.
- `client.ts`: `ClientSession`. Joins with a per-room token derived from a stable browser token in `localStorage`, follows the host's updates, pings, and reconnects on its own after a drop.
- `session.ts`: `SessionSnapshot` and `GameSession` (shared by host and client), and `ViewChannel`, which sends a player only what changed (new events plus the top-level view fields that differ; `mergeView` folds these patches back into the full view) and renumbers events per player so gaps in `seq` don't reveal that hidden events happened. A join, rejoin, or new game gets the whole view.
- `protocol.ts`: the wire messages and validation of untrusted client input.
- `lobby.ts`: lobby view, names, and game config from seats and settings.
- `room.ts`: room codes (5 characters, no look-alikes) and share links (`?room=CODE`).
- `transport.ts`: the transport interface and `NetError` codes with player-facing messages.
- `peerjs.ts` (primary): the host registers `vesper-room-<CODE>` on the public PeerJS server; clients connect straight to it. Public STUN only, no TURN. Messages travel as JSON text: PeerJS's default binary packing took about 1 ms per 16-seat view, roughly 25 times JSON.stringify.
- `trystero.ts` (fallback): Trystero over public Nostr relays, used when the PeerJS server can't be reached. The relays are pinned (`NOSTR_RELAYS`): Trystero's own pick for our app id included relays that were down, blocked its event kinds, or rate-limited. `tests/e2e/nostr-relays.spec.ts` checks the pinned ones.
- `fallback.ts`: opens the room on every transport; clients try them in order.
- `memory.ts`: in-process transport for unit tests.

See `ledger/evidence/net/webrtc-pilot.md` in the mission space for the signaling comparison.

## Rules worth knowing

- Never send `GameState`, the seed, or another player's view to a client. Every client message goes through `ViewChannel.next`, which calls `viewFor` for that player only.
- The host's own seat uses the same `ViewChannel` path, so host and client UIs see identical data.
- Will and death-note edits emit no events; `ViewChannel` still sends the change because it diffs every view field.
- The host loop, the client-silence sweep, and client pings run on Worker-backed timers (`timers.ts`), so a hidden host tab keeps the game on time.

## Host reload resume

- `HostSession.save()` returns the room as JSON-safe data: code, host id, seats, settings, game state, bot states, seat tokens, bans, and the bot transcript. It holds every secret, so it stays in the host's own browser. `parseHostSave` checks a save read back from storage.
- `suspend()` stops the host without sending `closed` and closes the transport, so the signaling server lets go of the room id. `leave()` still tells everyone the game ended.
- `new HostSession({ resume: save, ... })` restores the room. Human seats start disconnected and keep their tokens. `open()` keeps the same code. If it gets `roomTaken` (the old page's id can linger for a moment), it retries every 2 s up to 8 times instead of picking a new code.
- Clients treat `roomNotFound` during their 30 s reconnect window as "the host may be reloading" and keep retrying. When the window ends, they show "The host left" if the room was missing on any attempt, or "Lost the connection" otherwise. The cost is that friends learn about a host who really closed the tab after about 30 s, not at once.
- `fallback.ts` rejects the whole room with `roomTaken` if any transport reports it. Opening on the others would send friends who try that transport first to a different room with the same code.
