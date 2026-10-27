# tests/e2e

Owner: platform and online play agent.

Multi-browser Playwright tests. `npm run e2e` builds and serves the site locally; set `E2E_BASE_URL=https://theoi.github.io/vesper/` to run against the deployed site.

- `@smoke`: fast, network-free tests (home page, solo play, a solo game surviving a reload). CI runs these on every PR.
- `@online`: real WebRTC through public signaling and STUN (`online.spec.ts`): a host and friends join by link, play a full game, rejoin after a reload, get kicked, hit a bad code, and see the host leave. `resume.spec.ts` reloads the host's page mid-game and checks that friends get their seats back and the game continues. `rematch.spec.ts` plays two games back to back in one room: the host returns everyone to the lobby and deals again, with the same friends, bots, and settings and no reconnects. A hidden-information audit (`tests/support/leak-audit.ts`) checks every message each friend's browser received against the host's log. `NET=trystero-nostr` forces the fallback transport. `nostr-relays.spec.ts` checks that the fallback's pinned Nostr relays (`NOSTR_RELAYS` in `src/net/trystero.ts`) still accept, deliver, and take a burst of Trystero's signaling events; it fails when more than one relay is unhealthy and prints which.
- `@bigtable`: a full table over real WebRTC (`big-table.spec.ts`): the host and 7 friends plus 8 bots, with a role list that puts three Mourners and four Syndicate at the table. Every person runs an in-page autopilot that chats on each channel it may use, whispers, votes, judges, and acts at night. The host deals again (up to `BIGTABLE_GAMES`, default 3) until a friend has received every kind of private message (role, Syndicate chat and kill picks, dead chat, the Mourner, whispers and their notices, night results). Then every friend's messages are audited game by game, and the host's message rate, bandwidth, view fan-out time, main-thread CPU, view latency, and chat round trip land in `test-results/big-table.json`.
- `@perf`: how busy the v2 UI keeps the host's main thread in a solo game (`perf.spec.ts`), in default headless Chromium, which composites in software like a browser without GPU compositing. It measures resting in the day, resting at night, and while a sequence plays (the `stage` hook's `data-phase` and `data-sequence`), with and without reduced motion, and fails when resting is above `PERF_MAX_BUSY_PCT` (default 30) or sequences are above `PERF_MAX_SEQUENCE_PCT` (default 50). Not run on PRs.
- `@pilot`: the WebRTC signaling pilot (`net-pilot.spec.ts`).
- `@claude`: real Claude bots through the browser on the live site (`claude.spec.ts`), run by the manual `claude-browser-e2e.yml` workflow.
- `manual/hidden-host.mjs`: checks that the host's game loop keeps time while its tab is hidden (Chrome throttles hidden tabs). It drives Chromium over raw CDP because Playwright keeps every tab "visible"; usage is in the file header.

`asset-cache.spec.ts` (`@smoke`) checks that the service worker caches hashed files, serves them on reload, leaves pages to the network, and goes away with `?sw=0`.

`support/harness.ts` opens isolated browser contexts per player with network recording on (pass `{ serviceWorkers: 'block' }` to `openPlayer` when a test intercepts or counts the page's requests, as the Claude and relay specs do, since Playwright can't see requests a service worker answers), and reads back each page's received messages and the host's secrets for audits. UI hooks are listed in `src/app/README.md`.

Suites run against the default game UI: pages open without `?ui`, as players' do, and the harness fails if a page fell back to the shell. `UI=shell` runs a suite against the fallback shell (`?ui=shell`).

Example: `E2E_BASE_URL=https://theoi.github.io/vesper/ npx playwright test --grep @online`
