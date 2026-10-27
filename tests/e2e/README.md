# tests/e2e

Owner: platform and online play agent.

Multi-browser Playwright tests. `npm run e2e` builds and serves the site locally; set `E2E_BASE_URL=https://theoi.github.io/vesper/` to run against the deployed site.

- `@smoke`: fast, network-free tests (home page, solo play). CI runs these on every PR.
- `@online`: real WebRTC through public signaling and STUN (`online.spec.ts`): a host and friends join by link, play a full game, rejoin after a reload, get kicked, hit a bad code, and see the host leave. A hidden-information audit (`tests/support/leak-audit.ts`) checks every message each friend's browser received against the host's log. `NET=trystero-nostr` forces the fallback transport.
- `@pilot`: the WebRTC signaling pilot (`net-pilot.spec.ts`).

`support/harness.ts` opens isolated browser contexts per player with network recording on, and reads back each page's received messages and the host's secrets for audits. UI hooks are listed in `src/app/README.md`.

Example: `E2E_BASE_URL=https://theoi.github.io/vesper/ npx playwright test --grep @online`
