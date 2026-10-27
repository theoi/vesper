# src/app

Owner: platform and online play agent (for now). The art and sound agent replaces the placeholder shell with the real UI in `src/ui`.

## Layers

- `controller.ts`: `AppController`, the only object a UI needs. It owns the current room session and exposes:
  - **State:** `getState()` and `subscribe(listener)` return an `AppState` with `screen` (`home` or `room`), the remembered `name`, `linkCode` (from a share link), `link` (the room's share link), `homeError`, and `session` (a `SessionSnapshot` from `src/net`, or null).
  - **Room actions:** `hostRoom(name, { online, seats? })` (online `false` plays solo, fully offline), `joinRoom(codeOrLink, name)`, `leaveRoom()`, `goHome()`.
  - **Lobby actions (host):** `addBot(n)`, `fillWithBots(total)`, `removeSeat(id)` (bots are removed, humans are kicked and banned from the room), `updateSettings({ pace, roles })`, `start()` (returns an error message or null), `backToLobby()`. Anyone: `rename(name)`.
  - **Game intents:** `chat(channel, text)`, `whisper(to, text)`, `vote(target | null)`, `judge(ballot)`, `nightAction(targets | null)`, `reveal()`, `setWill(text)`, `setDeathNote(text)`, `ready(bool)`, or `send(intent)` for any engine `Intent`. Each returns an id; a rejected intent shows up as `session.lastRejection` with the same id.
  - **Claude bot chat (host only):** `setClaudeKey(key, { remember })` (the key stays in this browser: memory, plus localStorage only with `remember`; it goes only to Anthropic), `setClaudeSettings({ model, workspaceId, enabled })`, `testClaude()` (one tiny request; resolves with the status), `forgetClaude()`, and `botTranscript()` (this game's bot lines, each tagged `source: 'claude' | 'scripted'` with a fallback `reason`). `state.claude` has `status` (`off`, `ok`, `invalid-key`, `browser-blocked`, `rate-limited`, `degraded`, with a ready-to-show `detail`), `hasKey`, `remembered`, `enabled`, `model`, `workspaceId`, call and line counts, and estimated cost. It never contains the key.
  - **Host reload resume:** `saveHost()` (keep a copy of the hosted room in `hostStore`), `suspendHost()` (save, then go quiet without ending the game; for `pagehide`), and `resumeHost()` (bring back the saved room after a reload; returns false if there is no save, the save is from another build (`buildId`), or it is older than 10 minutes). `leaveRoom()` deletes the save.
  - `controller.host` is the `HostSession` when this browser hosts, else null.
- `shell.ts`: a plain DOM renderer over the controller. It is a placeholder: swap `mountShell` for the real UI and keep the controller.
- `format.ts`: plain-text helpers (phase labels, event descriptions, role names).
- `main.ts`: boot. Builds the controller, mounts the shell, handles `?room=` links (a remembered name rejoins automatically), and keeps the hosted room resumable. It saves the room to `sessionStorage` every 5 s and when the tab is hidden. On `pagehide` it suspends the room without ending it. On boot it resumes a saved room before anything else. The Leave button still ends the room for everyone.

## Reading a session snapshot

`state.session` (`SessionSnapshot` in `src/net/session.ts`):

- `status`: `connecting`, `reconnecting`, `lobby`, `playing`, `ended`, `closed` (host left, kicked, or replaced; see `notice`), or `error` (could not join; see `notice`).
- `lobby`: seats, settings, the role list in use, and its validation.
- `view`: the engine `PlayerView` for this player. `view.events` holds every event this player has received this game, in order.
- `clockOffset`: add to `Date.now()` to get host time; phase timers (`view.phase.endsAt`) are in host time.
- `network` (host): whether friends can reach the room (`offline`, `opening`, `open`, `error`).
- `notice`: `{ code, message }` with a ready-to-show message for `closed` and `error`.

## Test hooks

E2E tests drive the UI through these. Keep them when restyling (or update `tests/e2e` in the same change).

- `window.__vesper`: the `AppController`. With `localStorage['vesper.netlog'] = '1'`, `window.__vesper.netLog` records every message received from the host.
- `?net=peerjs` or `?net=trystero-nostr` forces one transport (default: PeerJS with Trystero fallback).
- `?claudeCalls=N` lowers the per-game Claude call budget (cost control for tests).

`data-testid` hooks:

| Screen     | Hooks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home       | `screen-home`, `name-input`, `host-online`, `host-solo`, `code-input`, `join`, `home-error`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Connecting | `screen-connecting`, `connecting`, `leave`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Notice     | `screen-notice`, `notice` (attribute `data-code` holds the notice code), `go-home`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Lobby      | `screen-lobby`, `room-code`, `room-link`, `copy-link`, `network-status`, `banner`, `seats`, `seat-<i>` (with `data-player-id`, `data-kind`), `seat-count`, `remove-<i>`, `add-bot`, `fill-count`, `fill-bots`, `pace`, `role-list`, `validation`, `start`, `start-error`, `waiting`, `rename-input`, `rename`, `leave`; host-only Claude panel: `claude-panel`, `claude-key`, `claude-remember`, `claude-save`, `claude-test`, `claude-forget`, `claude-enabled`, `claude-model`, `claude-workspace`, `claude-status` (with `data-state`), `claude-usage`                 |
| Game       | `screen-game`, `phase`, `timer`, `claude-status` (host with a key; `data-state`), `banner`, `role-card`, `you-role` (with `data-role`), `teammates`, `players`, `player-<seat>` (with `data-player-id`, `data-alive`), `vote-<seat>`, `night-<seat>`, `clear-vote`, `clear-night`, `trial`, `judge-guilty`, `judge-innocent`, `judge-abstain`, `ready`, `reveal`, `chat-channel`, `chat-input`, `chat-send`, `rejection`, `log` (items carry `data-type`, `data-seq`), `will-input`, `will-save`, `deathnote-input`, `deathnote-save`, `result`, `back-to-lobby`, `leave` |
