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
for (const s of d.speech) state = applyIntent(state, bot.id, s.intent, now).state; // chat first
for (const i of d.intents) state = applyIntent(state, bot.id, i, now).state; // then votes, actions, ready
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
- **Human chat** (`parse.ts`) is read best-effort: claims ("I'm the Augur, Bea is suspicious"), accusations, defenses, and questions aimed at a bot. Wills in the `N1: Name - Suspicious` format are parsed too.

## The LLM seam

Each `BotSpeech` carries `intent` (scripted text, ready to apply), `act` (a `SpeechAct`: the structured meaning, also sent as `intent.meta`), `category` (the template kind), and `personality`. A chat layer may rewrite only `intent.text`, using the act, category, personality voice, and the bot's own view. Decisions never depend on the text, so a failed or slow LLM call can always fall back to the scripted line.
