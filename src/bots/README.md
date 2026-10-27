# src/bots

Owner: rules engine and bots agent.

Scripted bots that play full games: they chat, claim, bluff, vote, judge, and take night actions. A bot decides only from its own `PlayerView`; nothing in this folder can reach the host's `GameState` (a unit test enforces the imports).

## Host loop

```ts
import { createBot, decideBot } from '../bots/index.ts';
import { applyIntent, viewFor } from '../engine/index.ts';

let bot = createBot(playerId, seed); // optional: { personality: 'hothead' }
// At bot.wakeAt, and whenever new events arrive:
const d = decideBot(bot, viewFor(state, bot.id, { sinceSeq: bot.seenSeq }), now);
bot = d.bot;
for (const i of d.intents) state = applyIntent(state, bot.id, i, now).state; // votes, actions, ready
for (const s of d.speech) state = applyIntent(state, bot.id, s.intent, now).state; // then chat
```

## How a bot thinks

- **Memory** (`memory.ts`) turns events into suspicion scores with reasons. Inputs include its own night results, claims and claimed results (weighted by how far it trusts the claimant), contradictions with the role list or its own role, votes and ballots re-read once a role is revealed, wills, and accusations against it.
- **Policy** (`policy.ts`) picks night targets per role, votes (with bandwagons, and more pressure after quiet days), ballots, Magistrate reveals, claims, cover stories, and wills.
  - The Syndicate coordinates kills in its chat, and the Hatchet follows the Patron's order.
  - Killers stop hitting targets that keep surviving.
  - Bluffers (Syndicate, Cutthroat, Accuser, Harlequin) claim Town covers. Bold ones fake an Augur claim with fabricated results.
- **Speech** (`brain.ts`, `lines.ts`) queues topics per phase and speaks them on a human-like clock:
  - Topics include reactions to deaths, wills, and verdicts, plus claims, accusations with reasons, questions, defenses, Syndicate plans, and the dead talking to the Mourner.
  - Each topic renders from large template pools and then passes through one of 12 personalities (temperament, verbosity, boldness, trust, and quirks such as lowercase, nicknames, or a catchphrase).
  - Bots avoid repeating their own recent lines or echoing lines they just heard.
- **Human chat** (`parse.ts`) is read best-effort: claims ("I'm the Augur, Bea is suspicious", "Augur here"), accusations ("vote Cal", "your story doesn't add up"), challenges ("Ada, are you Syndicate?"), defenses, and questions aimed at a bot. Wills in the `N1: Name - Suspicious` format are parsed too.
- **Answering** (`brain.ts`). A bot that is spoken to answers within a few seconds, even if it has already used its lines for the phase (up to two extra). A question about its role gets a claim or a reason to hold it back (`answerRole`). "Who do you suspect?" gets its top suspect, or "no read yet". Other questions get a plain reply. An accusation gets a defense, and a counter-accusation if the bot already distrusts the accuser. Someone claiming a Town bot's unique role gets an immediate counter-claim and a callout. Claims of power roles get belief or doubt in the same phase. A question to the whole table ("Who do you all suspect?") from a person gets a few answers, not one from every bot.
- **Table pace** (`brain.ts`, `policy.ts`). Bots play at a speed a person can follow:
  - Chat shares one room budget: about 0.7 public lines a second at 9 seats (`roomRate`: 0.5 + 0.02 per seat, at most 0.85) over a 6 s window, counting people too. Small talk yields first, news (claims, accusations, defenses, wills) gets a little headroom and carries over into the vote, and an answer owed to a person skips the queue. Each bot also says less at big tables.
  - Day 1 opens quietly (first lines after 2.5–5 s). Nobody puts a question to a person by name in the first 15 s of Day 1, and the room asks each person by name at most once a day.
  - Votes come over the first half of the voting phase, bold bots first, and some bots hold out for a stronger case. Halfway through with no name gathering support, one bot puts its suspect forward and others may follow. A trial still waits for `view.trialOpensAt` (see `src/engine/README.md`).
  - Ballots come after a few seconds. Hard evidence (a Suspicious result, a lie, shielding a Syndicate member) means guilty. Clashing claims and bad wagons split the table, leaning on how much suspicion has piled up. A hunch against a believable claim usually gets innocent. In sims about a quarter of verdicts are innocent.

## The LLM seam

Each `BotSpeech` carries `intent` (scripted text, ready to apply), `act` (a `SpeechAct`: the structured meaning, also sent as `intent.meta`), `category` (the template kind), and `personality`. A chat layer may rewrite only `intent.text`, using the act, category, personality voice, and the bot's own view. Decisions never depend on the text, so a failed or slow LLM call can always fall back to the scripted line.

## Claude chat (`llm/`)

`src/bots/llm/` is that chat layer. It calls the Anthropic Messages API straight from the host's browser with the key the host enters, and it is the only code in this folder that touches the network (through an injectable `fetch`). In relay mode (`configure({ mode: 'relay', relayUrl, relayPassphrase })`), it sends requests to the host's own relay (`relay/`, a Cloudflare Worker) with an `x-relay-passphrase` header and no key; the relay adds the key on the server and passes Anthropic's replies through, and its own refusals (`relay_auth`, `relay_origin`, `relay_config`, `relay_model`) map to the `relay-error` status or the model message.

```ts
import { ChatLayer, loadSettings, saveSettings, voiceSpeech } from '../bots/llm/index.ts';

const chat = new ChatLayer(loadSettings(localStorage)); // key, model, on/off
chat.subscribe((s) => showClaudeStatus(s.state, s.detail)); // off | ok | invalid-key | browser-blocked | relay-error | rate-limited | degraded
chat.configure({ apiKey, model: 'claude-haiku-5-5', enabled: true }); // from the settings screen
saveSettings(localStorage, { apiKey, model }, rememberKey); // the key is stored only if the host asks
await chat.check(); // optional "Test key" button: one tiny request

chat.newGame(); // resets the per-game call budget
// HostSession hook: rewriteSpeech: ({ view, speech }) => chat.rewriteText({ view, speech }) (null = scripted)
// Pass a full view (viewFor(state, bot.id), no sinceSeq): prompts use the bot's chat history and past claims.
// Or, per bot line (apply votes and actions right away; lines may arrive a little later):
const { speech } = await voiceSpeech(chat, viewFor(state, bot.id), d.speech[i]);
applyIntent(state, bot.id, speech.intent, Date.now()); // drop it if the engine rejects it (phase moved on)
```

- **Never breaks the game.** `rewrite` always resolves. Without a key, with a bad key, on a rate limit, timeout (4 s by default, queueing included), network or server error, refusal, spent budget, or guardrail rejection, it returns the scripted text and a `reason`.
- **Status.** 401/403 or a key that needs a workspace → `invalid-key` and no more calls until the key changes. A 401 saying the key's organization refuses browser (CORS) requests, which Anthropic does for organizations with custom data retention, → `browser-blocked`, with the same stop; its detail points the host to their own relay (My relay). 429 → `rate-limited` until `retry-after`. A spend limit or a missing model → `degraded` with a plain explanation. Three failures in a row → `degraded`; five → a 30 s cool-down. A success returns to `ok`.
- **Limits.** 300 calls per game (a long 9-player game uses about 225; about $0.04 at Haiku prices), 3 in flight, 45 per minute. Low-value lines (greetings, banter) are skipped first when the budget or rate runs low.
- **Prompt.** A static system prompt (game rules, this game's role names, style rules; cached by the API) plus a per-line message built only from the bot's own `PlayerView`: persona and quirks, its role, partners if Syndicate, its own night results, its public story, the public situation and claims, the last 14 chat lines and events it can see, the line's purpose (from the act), and the scripted draft. Player chat is wrapped in `<chat>` and flattened so it cannot pose as instructions.
- **Guardrails** (`guard.ts`). Replies are cleaned (first line, no labels, quotes, markdown, stage directions, emojis; cut at a sentence end under 160 characters) and rejected when they drop the act's target, role, or results; name players nobody mentioned; point accusations somewhere new; name a living Syndicate partner or hint at the team in public; claim a role the line does not claim; admit to being Syndicate; mention AI, prompts, or drafts; use another game's role names; or out the Mourner in the dead chat.
- **Key.** Held in memory (a private field), sent only in the `x-api-key` header to `api.anthropic.com`, never in status, metrics, or errors, and written to storage only when the host opts in.
- **Model.** `claude-haiku-5-5` by default, with `output_config.effort: "low"` and thinking disabled. Another model can be chosen; a model that rejects either parameter gets it dropped automatically.

### Real-Claude runs

`scripts/claude-sim.ts` plays headless games through the layer, with one seat acting as a human stand-in that asks bots questions, accuses them, and tries to break them. It writes transcripts (each line with its draft and how it was produced), `lines.jsonl`, `metrics.json`, and `report.md`.

```sh
node scripts/claude-sim.ts --dry-run --games 2 --dump-prompts 50 --out out   # offline; dumps prompts
node scripts/claude-sim.ts --replies replies.json --games 4 --parallel 1 --out out   # stand-in replies
ANTHROPIC_API_KEY=... node scripts/claude-sim.ts --games 3 --out out   # live
```

The **Claude bots** workflow (`.github/workflows/claude-bots.yml`, manual only) runs the live mode with the `ANTHROPIC_API_KEY` repository secret, caps the run by calls and estimated spend, and uploads the output as an artifact.
