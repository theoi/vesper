# scripts

Node scripts. They run with Node's built-in TypeScript support (Node 22.12+), with no build step.

## Simulation

```bash
npm run sim -- --games 5000                 # bot-only games across 7–15 players
npm run sim -- --games 500 --players 12     # one table size
npm run sim -- --games 5000 --out sim-out --transcripts 3
```

Options: `--games N`, `--players A-B`, `--seed S`, `--workers W`, `--timers fast|default`, `--out DIR` (writes `sim-report.md`, `sim-report.json`, and optional transcripts), `--transcripts N`.

`simcore.ts` referees each game with full state. Bots see only their own views. Every step is audited independently of the engine:

- Only living players vote, act at night, or speak publicly.
- Nobody dies twice.
- Phase transitions are legal and event sequence numbers have no gaps.
- Syndicate chat reaches only the Syndicate.
- Dead chat reaches only the dead and a living Mourner at night.
- Sampled views leak no hidden roles.
- The declared winners match the win conditions.

The script exits non-zero on any violation or unfinished game.

## Pacing with stand-in humans

```bash
node scripts/pacing.ts --games 1000 --players 9 --humans 1             # fast pace
node scripts/pacing.ts --games 500 --players 15 --humans 2 --pace standard
```

Options: `--games N`, `--players P`, `--humans H`, `--seed S`, `--pace fast|standard`, `--human-vote LO-HI` (ms after voting opens that a stand-in votes, default `4500-9000`), `--human-vote-chance X` (default 0.8).

`runGame({ humans })` seats stand-in people (`standin.ts`): they chat in plain text with no `meta`, answer when named, vote and judge after human-like delays, and act at night. The game loop runs like `HostSession`: timers first, then each player in seat order, waking bots about 400 ms after new events (`reactMs`). The report covers what a person at the table sees: voting days with a trial, time to the first trial, how often the stand-in could vote before a trial started, guilty and innocent verdicts by the defendant's side, public lines per second in discussion, the busiest 5 s, questions that name a person early on Day 1, and win rates.
