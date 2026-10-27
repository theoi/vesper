/**
 * Headless bot-only simulation.
 *
 *   npm run sim -- --games 5000 [--players 7-15] [--seed 1] [--workers 4]
 *                  [--timers fast|default] [--out dir] [--transcripts 2]
 *
 * Plays games with fast-forwarded timers and reports termination, winners by
 * faction and setup, invariant violations, game length, and runtime.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DEFAULT_TIMERS, FAST_TIMERS, ROLES, presetFor } from '../src/engine/index.ts';
import { runGame, type SimResult } from './simcore.ts';

interface Args {
  games: number;
  minPlayers: number;
  maxPlayers: number;
  seed: number;
  workers: number;
  timers: 'fast' | 'default';
  out: string | null;
  transcripts: number;
}

type Summary = Omit<SimResult, 'state'>;

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const players = (get('players') ?? '7-15').split('-').map(Number);
  return {
    games: Number(get('games') ?? 1000),
    minPlayers: players[0] ?? 7,
    maxPlayers: players[1] ?? players[0] ?? 15,
    seed: Number(get('seed') ?? 1),
    workers: Number(get('workers') ?? Math.max(1, Math.min(8, availableParallelism()))),
    timers: get('timers') === 'default' ? 'default' : 'fast',
    out: get('out') ?? null,
    transcripts: Number(get('transcripts') ?? 0),
  };
}

function playersFor(a: Args, i: number): number {
  const span = a.maxPlayers - a.minPlayers + 1;
  return a.minPlayers + (i % span);
}

function runRange(a: Args, start: number, count: number): Summary[] {
  const timers = a.timers === 'default' ? DEFAULT_TIMERS : FAST_TIMERS;
  const out: Summary[] = [];
  for (let i = start; i < start + count; i++) {
    out.push(runGame({ seed: a.seed + i, players: playersFor(a, i), timers }));
  }
  return out;
}

async function runAll(a: Args): Promise<Summary[]> {
  const workers = Math.max(1, Math.min(a.workers, a.games));
  if (workers === 1) return runRange(a, 0, a.games);
  const per = Math.ceil(a.games / workers);
  const jobs: Promise<Summary[]>[] = [];
  for (let w = 0; w < workers; w++) {
    const start = w * per;
    const count = Math.min(per, a.games - start);
    if (count <= 0) break;
    jobs.push(
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { a, start, count } });
        worker.once('message', (m: Summary[]) => resolve(m));
        worker.once('error', reject);
      }),
    );
  }
  return (await Promise.all(jobs)).flat();
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${((100 * n) / d).toFixed(1)}%`);

function report(a: Args, results: Summary[], ms: number) {
  const n = results.length;
  const ended = results.filter((r) => r.ended).length;
  const violations = results.flatMap((r) => r.violations.map((v) => `seed ${r.seed}: ${v}`));
  const outcomes = ['town', 'mafia', 'cutthroat', 'draw'] as const;
  const count = (rs: Summary[], o: string) => rs.filter((r) => r.result?.outcome === o).length;
  const reasons = new Map<string, number>();
  for (const r of results) {
    const k = `${r.result?.outcome}/${r.result?.reason}`;
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  const avg = (f: (r: Summary) => number) => results.reduce((s, r) => s + f(r), 0) / Math.max(1, n);
  const bySize: {
    players: number;
    preset: string;
    games: number;
    town: number;
    mafia: number;
    cutthroat: number;
    draw: number;
    days: number;
    flag: string;
  }[] = [];
  for (let p = a.minPlayers; p <= a.maxPlayers; p++) {
    const rs = results.filter((r) => r.players === p);
    if (rs.length === 0) continue;
    const town = count(rs, 'town');
    const hostile = rs.length - town - count(rs, 'draw');
    const share = town / rs.length;
    let flag = 'ok';
    if (share > 0.65) flag = 'town-favored';
    else if (share < 0.35) flag = 'hostile-favored';
    if (count(rs, 'draw') / rs.length > 0.15) flag += ', many draws';
    void hostile;
    bySize.push({
      players: p,
      preset: presetFor(p).name,
      games: rs.length,
      town,
      mafia: count(rs, 'mafia'),
      cutthroat: count(rs, 'cutthroat'),
      draw: count(rs, 'draw'),
      days: rs.reduce((s, r) => s + r.days, 0) / rs.length,
      flag,
    });
  }
  const neutral = results.reduce(
    (acc, r) => {
      for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += r.neutral[k];
      return acc;
    },
    {
      harlequins: 0,
      harlequinExecuted: 0,
      accusers: 0,
      accuserWon: 0,
      drifters: 0,
      drifterAlive: 0,
    },
  );
  const roleWins = new Map<string, { n: number; won: number }>();
  for (const r of results) {
    for (const [id, role] of Object.entries(r.originalRoles)) {
      const e = roleWins.get(role) ?? { n: 0, won: 0 };
      e.n++;
      if (r.result?.winners.includes(id)) e.won++;
      roleWins.set(role, e);
    }
  }
  const json = {
    args: a,
    games: n,
    ended,
    runtimeMs: Math.round(ms),
    msPerGame: ms / Math.max(1, n),
    violations: violations.length,
    violationSamples: violations.slice(0, 20),
    rejectedIntents: results.reduce((s, r) => s + r.rejected, 0),
    rejectedSamples: results.flatMap((r) => r.rejectedSamples).slice(0, 10),
    outcomes: Object.fromEntries(outcomes.map((o) => [o, count(results, o)])),
    reasons: Object.fromEntries(reasons),
    avgDays: avg((r) => r.days),
    avgGameMinutes: avg((r) => r.gameTimeMs) / 60000,
    avgChatLines: avg((r) => r.chatLines),
    avgBotCalls: avg((r) => r.botCalls),
    bySize,
    neutral,
    roleWinRates: Object.fromEntries([...roleWins].map(([k, v]) => [k, v.won / v.n])),
  };
  const lines: string[] = [];
  lines.push(`# Vesper simulation report`, ``);
  lines.push(
    `${n} bot-only games, ${a.minPlayers}–${a.maxPlayers} players, ${a.timers} timers, seeds ${a.seed}–${a.seed + n - 1}, ${a.workers} workers.`,
    ``,
  );
  lines.push(`| Check | Result |`, `| --- | --- |`);
  lines.push(`| Games that ended | ${ended} / ${n} (${pct(ended, n)}) |`);
  lines.push(`| Invariant violations | ${violations.length} |`);
  lines.push(`| Rejected bot intents | ${json.rejectedIntents} |`);
  lines.push(`| Runtime | ${(ms / 1000).toFixed(1)} s (${json.msPerGame.toFixed(1)} ms/game) |`);
  lines.push(
    `| Average length | ${json.avgDays.toFixed(2)} days, ${json.avgGameMinutes.toFixed(1)} game-minutes |`,
  );
  lines.push(`| Average chat lines per game | ${json.avgChatLines.toFixed(0)} |`, ``);
  lines.push(`## Outcomes`, ``, `| Outcome | Games | Share |`, `| --- | --- | --- |`);
  for (const o of outcomes)
    lines.push(`| ${o} | ${count(results, o)} | ${pct(count(results, o), n)} |`);
  lines.push(``, `| Outcome / reason | Games |`, `| --- | --- |`);
  for (const [k, v] of [...reasons].sort((x, y) => y[1] - x[1])) lines.push(`| ${k} | ${v} |`);
  lines.push(``, `## By setup`, ``);
  lines.push(
    `| Players | Preset | Games | Town | Syndicate | Cutthroat | Draw | Avg days | Balance |`,
  );
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const s of bySize) {
    lines.push(
      `| ${s.players} | ${s.preset} | ${s.games} | ${pct(s.town, s.games)} | ${pct(s.mafia, s.games)} | ${pct(s.cutthroat, s.games)} | ${pct(s.draw, s.games)} | ${s.days.toFixed(1)} | ${s.flag} |`,
    );
  }
  lines.push(``, `## Neutral goals`, ``);
  lines.push(
    `- Harlequin executed: ${pct(neutral.harlequinExecuted, neutral.harlequins)} of ${neutral.harlequins}`,
  );
  lines.push(
    `- Accuser target executed: ${pct(neutral.accuserWon, neutral.accusers)} of ${neutral.accusers}`,
  );
  lines.push(
    `- Drifter alive at the end: ${pct(neutral.drifterAlive, neutral.drifters)} of ${neutral.drifters}`,
    ``,
  );
  lines.push(`## Win rate by dealt role`, ``, `| Role | Win rate |`, `| --- | --- |`);
  for (const [k, v] of [...roleWins].sort((x, y) => x[0].localeCompare(y[0]))) {
    lines.push(`| ${ROLES[k as keyof typeof ROLES]?.name ?? k} | ${pct(v.won, v.n)} |`);
  }
  if (violations.length > 0) {
    lines.push(``, `## Violation samples`, ``, ...violations.slice(0, 20).map((v) => `- ${v}`));
  }
  return { json, markdown: lines.join('\n') + '\n' };
}

function transcript(seed: number, players: number, timers: 'fast' | 'default'): string {
  const r = runGame({
    seed,
    players,
    timers: timers === 'default' ? DEFAULT_TIMERS : FAST_TIMERS,
    keepState: true,
  });
  const s = r.state;
  if (!s) return '';
  const name = (id: string | null | undefined) => s.players.find((p) => p.id === id)?.name ?? '?';
  const lines = [`# Transcript: seed ${seed}, ${players} players`, ``];
  lines.push(
    `Roles: ${s.players.map((p) => `${p.name} (${ROLES[p.originalRole].name})`).join(', ')}`,
    ``,
  );
  for (const e of s.log) {
    const where = `[${e.phase} ${e.day}]`;
    if (e.type === 'phase') lines.push(``, `## ${e.phase} ${e.day}`);
    else if (e.type === 'chat') {
      const who = e.from ? name(e.from) : (e.fromLabel ?? '?');
      const ch = e.channel === 'public' ? '' : ` (${e.channel}${e.to ? ` to ${name(e.to)}` : ''})`;
      if (e.audience === 'all' || e.channel !== 'dead' || e.from)
        lines.push(`- **${who}**${ch}: ${e.text}`);
    } else if (e.type === 'vote')
      lines.push(`- ${where} ${name(e.voter)} votes ${e.target ? name(e.target) : 'nobody'}`);
    else if (e.type === 'trial') lines.push(`- ${where} **${name(e.defendant)} is on trial**`);
    else if (e.type === 'verdict')
      lines.push(
        `- ${where} verdict: ${e.guilty ? 'GUILTY' : 'innocent'} (${e.guiltyWeight}–${e.innocentWeight})`,
      );
    else if (e.type === 'death')
      lines.push(
        `- ${where} **${name(e.player)} died** (${e.causes.join(', ')}; ${e.role ? ROLES[e.role].name : 'role hidden'})`,
      );
    else if (e.type === 'magistrateReveal')
      lines.push(`- ${where} ${name(e.player)} reveals as Magistrate`);
    else if (e.type === 'gameOver')
      lines.push(
        ``,
        `**Game over: ${e.result.outcome} (${e.result.reason}). Winners: ${e.result.winners.map(name).join(', ')}**`,
      );
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const results = await runAll(a);
  const ms = performance.now() - t0;
  const { json, markdown } = report(a, results, ms);
  process.stdout.write(markdown);
  if (a.out) {
    mkdirSync(a.out, { recursive: true });
    writeFileSync(join(a.out, 'sim-report.md'), markdown);
    writeFileSync(join(a.out, 'sim-report.json'), JSON.stringify(json, null, 2));
    for (let i = 0; i < a.transcripts; i++) {
      const players = playersFor(a, i * 4);
      writeFileSync(
        join(a.out, `transcript-${i + 1}.md`),
        transcript(a.seed + i * 4, players, a.timers),
      );
    }
  }
  if (json.violations > 0 || json.ended < json.games) process.exitCode = 1;
}

if (isMainThread) {
  void main();
} else {
  const { a, start, count } = workerData as { a: Args; start: number; count: number };
  parentPort?.postMessage(runRange(a, start, count));
}
