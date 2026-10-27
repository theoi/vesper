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
