# Vesper

An avant-garde browser social deduction game: hidden roles, a day and night cycle, and talk-driven deduction. Play online with friends in your browser, with bots filling empty seats.

Live site: https://theoi.github.io/vesper/

> Work in progress. A full guide to playing, hosting, and enabling Claude bots will land here.

## Claude bots (optional)

The host can let bots write their chat with Claude. In the lobby, paste an Anthropic API key into **Claude bots** and press **Use key**; the status shows whether it works. The key stays in the host's browser (in memory, or in local storage if you tick **Remember on this device**) and is sent only to Anthropic, never to other players. If the key is missing or a call fails, bots fall back to scripted chat and the game carries on.

Some Anthropic organizations block requests made directly from a browser (for example, organizations with custom data retention settings). Keys from those organizations show as rejected; use a key from an organization or workspace without custom retention.

## Development

Requires Node 22.12 or newer.

```bash
npm install
npm run dev        # local dev server at http://localhost:5173/vesper/
npm run check      # typecheck, lint, unit tests, build
npm run test       # unit tests (Vitest)
npm run e2e        # browser tests (Playwright); set E2E_BASE_URL to test a deployed site
npm run fix        # auto-fix lint and formatting
```

Run `npx playwright install chromium` once before the first `npm run e2e`.

## Layout

| Path          | What lives there                                                    |
| ------------- | ------------------------------------------------------------------- |
| `src/engine/` | Pure, deterministic rules engine (no DOM, no networking)            |
| `src/bots/`   | Bot brains and chat (decide only from their own `PlayerView`)       |
| `src/net/`    | WebRTC rooms, lobby, host-authoritative sessions                    |
| `src/ui/`     | Screens and visuals                                                 |
| `src/audio/`  | Procedural score and sound effects                                  |
| `src/app/`    | App entry and glue                                                  |
| `previews/`   | Live art and sound previews; each `index.html` becomes its own page |
| `labs/`       | Developer test pages; each `index.html` becomes its own page        |
| `tests/e2e/`  | Multi-browser Playwright tests                                      |
| `scripts/`    | Node scripts such as headless simulations                           |

Any `index.html` under `previews/` or `labs/` is built automatically and served at the same path, for example `previews/foo/index.html` becomes `/vesper/previews/foo/`.

## Deployment

Every push to `main` builds the site and deploys it to GitHub Pages through `.github/workflows/deploy.yml`. Pull requests run typecheck, lint, unit tests, a build, and an e2e smoke test.
