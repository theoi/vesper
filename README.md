# Vesper

A shadow play in one small town: a social deduction game in your browser. Everyone gets a secret role. Most players are the Town. A few are the Syndicate, who know each other and kill at night. A few loners want something else entirely. Talk, vote, and work out who is lying before it's too late.

**Play now: https://theoi.github.io/vesper/**

No accounts and no installs. Play alone with bots, or send friends a link. Bots fill any empty seats, and they can optionally write their lines with Claude.

## Play solo

1. Open the site, type your name, and click **Play solo with bots**.
2. The lobby seats you with bots. Use **Fill with bots** to choose the table size (4 to 16 seats), and pick **Standard pace** or **Fast pace**.
3. Click **Raise the curtain**.

A solo game is a complete game: the bots talk, accuse, claim roles, vote, and act at night.

## Host a game and invite friends

1. Type your name and click **Host a game**.
2. When the lobby says **Open for friends**, click **Copy link** and send the link to your friends. They can also type the five-letter room code under **Join with a code or link**.
3. Friends open the link, type a name, and click **Join**. Their seats appear in your lobby. Fill the rest with bots, choose the pace, and click **Raise the curtain**.
4. After the game, click **Back to lobby** to play again with the same table. Everyone stays connected.

Your browser runs the game, so keep the tab open until it ends. If you reload, the game picks up where it was and friends get their seats back. A friend who reloads or drops out rejoins the same seat.

## How a game goes

- **Day:** talk it over, then vote to put someone on trial. Day 1 is for talking; voting starts on Day 2. A trial can't open in the first seconds of voting, so everyone gets a chance to vote; the vote meter counts down until it can.
- **Trial:** the accused gets a short defense, then everyone else votes **Guilty**, **Innocent**, or **Abstain**. More guilty than innocent, and the accused is executed.
- **Night:** roles with abilities use them in secret, and the Syndicate chooses someone to kill.
- **Dawn:** everyone sees who died, what role they had, and the will they left.

The Town wins when the whole Syndicate and any Cutthroat are dead. The Syndicate wins when it matches or outnumbers everyone else. Loners have goals of their own. **Help**, in the lobby and during the game, explains the rules, the current phase, and the glossary.

## Controls

- **Candles:** each player is a candle on the stage. Click a candle to vote for a trial during voting, or to choose your target at night. **Withdraw vote** and **Cancel night action** take it back.
- **Chat:** type in the chat box and press Enter. By day you speak to the **Town**. At night the Syndicate has its own chat. The dead speak in the **Séance**, and a living Mourner can hear them.
- **Whispers:** click **Whisper**, then click a candle to choose who hears you. Everyone sees that you whispered, but not what you said.
- **Your role:** click **You are …** in the top bar to open your role card: your goal, your ability, and tips.
- **Will:** click **Will** in the top bar, write what you know, and click **Seal the will**. Everyone reads it when you die. Killers can also seal a **Death note** for their victim.
- **Sequences:** dawn, nightfall, trials, and deaths play as short staged scenes. Press **Esc** or click the stage to skip one. They never hold up the game.
- **Ready:** ends the current phase early once everyone is ready.
- **Sound and motion:** the **Sound** button in the top bar mutes, and the slider next to it sets the volume. **Settings** has **Reduced motion**, which turns sequences into still frames and removes camera moves and flicker.

## Claude bots (optional)

The host can let bots write their chat with Claude. Claude only writes what a bot says, and its prompt is built from that bot's own view of the game, so it never learns more than the bot knows. If Claude is slow, fails, or runs out of its budget, bots fall back to their scripted lines and the game carries on. A game makes at most 300 Claude calls and 45 a minute.

You can connect Claude in two ways. Both are in the lobby under **Claude bots**, in online and solo games.

### With an API key

1. Choose **API key**, paste an Anthropic API key (from [console.anthropic.com](https://console.anthropic.com/settings/keys)), and click **Use key**.
2. The status shows whether it works. **Test** checks again, and **Forget** removes the key.

The key stays in the host's browser and is sent only to Anthropic, never to other players. It is kept in memory, or in local storage if you tick **Remember on this device**.

Some Anthropic organizations block requests made directly from a browser, for example organizations with zero or custom data retention. The status then says that the organization blocks browser requests and points you to **My relay**. Bots keep playing with their scripted lines; set up the relay below to use Claude with that key.

### With your own relay (your key never reaches a browser)

The relay is a small Cloudflare Worker that you deploy to your own free Cloudflare account. It holds your Anthropic key and a passphrase you make up. The game sends bot lines to the relay with the passphrase, and the relay calls Anthropic on the server.

1. [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/theoi/vesper/tree/main/relay) Sign in or sign up, connect GitHub, paste your key into **ANTHROPIC_API_KEY** and your passphrase into **RELAY_PASSPHRASE**, then click **Create and deploy**. Prefer a terminal? Run `cd relay && npm install && npx wrangler login && npx wrangler deploy`, then `npx wrangler secret put ANTHROPIC_API_KEY` and `npx wrangler secret put RELAY_PASSPHRASE`.
2. Copy the relay's address (`https://vesper-claude-relay.<you>.workers.dev`). Opening it in a browser should show `"ready": true`.
3. In the lobby, under **Claude bots**, choose **My relay**, paste the address and the passphrase, and click **Use relay**.

Full steps, settings, and what the relay does and doesn't protect: [relay/README.md](relay/README.md).

## Known limits

- **Strict networks.** Players connect directly to the host's browser (WebRTC) with no relay server in between. Some office, school, and VPN networks block these connections. A friend then sees "Found the host but could not connect directly". Trying another network, such as a phone hotspot, usually works.
- **The host must stay.** The host's browser runs the game. If the host closes the tab, the game ends for everyone. A reload is fine: friends wait about 30 seconds for the host to come back. The host can switch to another tab, and the game keeps time.
- **Keys from zero-data-retention organizations need the relay.** Anthropic blocks browser requests for those organizations, so use the relay above.
- **Among friends.** Rooms are private and joined by link or code. There are no accounts, stats, or public matchmaking. The host's browser holds the whole game state, so nothing stops a host from cheating.
- **Desktop first.** Desktop browsers are the main target. Phones work, on a best-effort basis.
- **Older UI.** If the stage doesn't work in your browser, add `?ui=shell` to the address for the plain fallback interface.

## Credits

Vesper's look, score, and sound design were made for this game.

- **Images:** the faces, shadow bodies, and the Mourner's hand were generated for Vesper with an AI image model. The characters are fictional.
- **Music and sound:** a procedural score, plus recorded samples: Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), VSCO 2: Community Edition by Versilian Studios (CC0), and sounds from Freesound under CC0 or CC BY.
- **Fonts:** IM Fell, Homemade Apple, Old Standard TT, Cormorant Garamond, Bodoni Moda, Archivo, Big Shoulders Display, Unbounded, and Space Mono, under the SIL Open Font License, bundled through Fontsource.
- **Libraries:** PeerJS and Trystero for connections.

Every sample's author, source, and license is listed in [CREDITS.md](CREDITS.md). The code is MIT-licensed.

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

Run `npx playwright install chromium` once before the first `npm run e2e`. Test tags and suites are described in [tests/e2e/README.md](tests/e2e/README.md).

## Layout

| Path           | What lives there                                                         |
| -------------- | ------------------------------------------------------------------------ |
| `src/engine/`  | Pure, deterministic rules engine (no DOM, no networking)                 |
| `src/bots/`    | Bot brains and chat (decide only from their own `PlayerView`)            |
| `src/net/`     | WebRTC rooms, lobby, host-authoritative sessions                         |
| `src/ui/`      | Screens and visuals                                                      |
| `src/audio/`   | Procedural score and sound effects                                       |
| `src/content/` | Player-facing text: help, role cards, labels                             |
| `src/app/`     | App entry and glue                                                       |
| `previews/`    | Live art and sound previews; each `index.html` becomes its own page      |
| `labs/`        | Developer test pages; each `index.html` becomes its own page             |
| `tests/e2e/`   | Multi-browser Playwright tests                                           |
| `scripts/`     | Node scripts such as headless simulations                                |
| `relay/`       | Optional Claude relay (Cloudflare Worker) that keeps the key server-side |

Any `index.html` under `previews/` or `labs/` is built automatically and served at the same path, for example `previews/foo/index.html` becomes `/vesper/previews/foo/`.

## Deployment

Every push to `main` builds the site and deploys it to GitHub Pages through `.github/workflows/deploy.yml`. Pull requests run typecheck, lint, unit tests, a build, and an e2e smoke test.
