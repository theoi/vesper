# src/net

Owner: platform and online play agent.

Host-authoritative online rooms over WebRTC. The host's browser runs the engine and bots. Remote players send intents and receive only their own `PlayerView` plus the events addressed to them, so no other player's secrets reach their browser.

## Pieces

- `host.ts`: `HostSession`. Lobby (seats, bots, settings, kick), game loop (`tick` at `nextDeadline`, bots via `decideBot` at `wakeAt` or when they have new events), per-player view streaming, rejoin by token, heartbeats, and an intent rate limit. Optional `rewriteSpeech` hook for the Claude chat layer: it may replace a bot line's text; failures and timeouts fall back to the scripted line.
- `client.ts`: `ClientSession`. Joins with a per-room token derived from a stable browser token in `localStorage`, follows the host's updates, pings, and reconnects on its own after a drop.
- `session.ts`: `SessionSnapshot` and `GameSession` (shared by host and client), and `ViewChannel`, which sends a player only what changed and renumbers events per player so gaps in `seq` don't reveal that hidden events happened.
- `protocol.ts`: the wire messages and validation of untrusted client input.
- `lobby.ts`: lobby view, names, and game config from seats and settings.
- `room.ts`: room codes (5 characters, no look-alikes) and share links (`?room=CODE`).
- `transport.ts`: the transport interface and `NetError` codes with player-facing messages.
- `peerjs.ts` (primary): the host registers `vesper-room-<CODE>` on the public PeerJS server; clients connect straight to it. Public STUN only, no TURN.
- `trystero.ts` (fallback): Trystero over public Nostr relays, used when the PeerJS server can't be reached.
- `fallback.ts`: opens the room on every transport; clients try them in order.
- `memory.ts`: in-process transport for unit tests.

See `ledger/evidence/net/webrtc-pilot.md` in the mission space for the signaling comparison.

## Rules worth knowing

- Never send `GameState`, the seed, or another player's view to a client. Every client message goes through `ViewChannel.next`, which calls `viewFor` for that player only.
- The host's own seat uses the same `ViewChannel` path, so host and client UIs see identical data.
- Will and death-note edits emit no events; `ViewChannel` still sends the change because it diffs the whole view.
