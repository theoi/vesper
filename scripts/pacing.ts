/**
 * Pacing report: plays headless games with stand-in humans and measures what a
 * person at the table experiences. See scripts/README.md.
 *
 *   node scripts/pacing.ts --games 300 --players 9 --humans 1 [--pace fast|standard] [--seed 1]
 */
import {
  DEFAULT_TIMERS,
  FAST_TIMERS,
  type GameEvent,
  type GameState,
} from '../src/engine/index.ts';
import { sideOf } from '../src/bots/knowledge.ts';
import { runGame, type SimResult } from './simcore.ts';

export interface PacingStats {
  games: number;
  outcomes: Record<string, number>;
  votingDays: number;
  daysWithTrial: number;
  /** Seconds from the first voting phase of a day opening to its trial. */
  firstTrialSec: number[];
  trialsBefore8s: number;
  guilty: number;
  innocent: number;
  /** Verdicts by the defendant's side, e.g. `guilty:town`. */
  verdictsBySide: Record<string, number>;
  /** Voting phases where a stand-in meant to vote and could (the trial had not started). */
  humanVoteChances: number;
  humanVotePlans: number;
  /** Public lines per second during discussion, Day 1 and later. */
  day1Rate: number[];
  laterRate: number[];
  /** Most public lines in any 5 s window. */
  peak5s: number[];
  /** Questions that name a human in the first 12 s of Day 1, and per human per day after. */
  earlyHumanQuestions: number;
  humanQuestionsPerDay: number[];
}

export function emptyStats(): PacingStats {
  return {
    games: 0,
    outcomes: {},
    votingDays: 0,
    daysWithTrial: 0,
    firstTrialSec: [],
    trialsBefore8s: 0,
    guilty: 0,
    innocent: 0,
    verdictsBySide: {},
    humanVoteChances: 0,
    humanVotePlans: 0,
    day1Rate: [],
    laterRate: [],
    peak5s: [],
    earlyHumanQuestions: 0,
    humanQuestionsPerDay: [],
  };
}

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;

export function measure(r: SimResult, st: PacingStats): void {
  const s = r.state as GameState;
  st.games++;
  const outcome = s.result?.outcome ?? 'unfinished';
  st.outcomes[outcome] = (st.outcomes[outcome] ?? 0) + 1;
  const humans = new Set(s.players.filter((p) => !p.isBot).map((p) => p.id));
  const log = s.log;
  const phases = log.filter((e): e is Ev<'phase'> => e.type === 'phase');
  const endOf = (i: number) => phases[i + 1]?.at ?? log.at(-1)?.at ?? 0;
  const endSeq = (i: number) => phases[i + 1]?.seq ?? Infinity;
  const seenDays = new Set<number>();
  phases.forEach((ph, i) => {
    const from = ph.at;
    const to = endOf(i);
    const inPhase = log.filter((e) => e.seq > ph.seq && e.seq < endSeq(i));
    if (ph.phase === 'voting' && !seenDays.has(ph.day)) {
      seenDays.add(ph.day);
      st.votingDays++;
      const trial = inPhase.find((e) => e.type === 'trial');
      if (trial) {
        st.daysWithTrial++;
        st.firstTrialSec.push((trial.at - from) / 1000);
        if (trial.at - from < 8000) st.trialsBefore8s++;
      }
      for (const h of r.standIns ?? []) {
        const plan = h.votePlans.find((x) => x.openedAt === from);
        if (!plan) continue;
        st.humanVotePlans++;
        if (!trial || trial.at > plan.voteAt) st.humanVoteChances++;
      }
    }
    if (ph.phase === 'discussion') {
      const lines = inPhase.filter(
        (e): e is Ev<'chat'> => e.type === 'chat' && e.channel === 'public',
      );
      const secs = Math.max(1, (to - from) / 1000);
      (ph.day === 1 ? st.day1Rate : st.laterRate).push(lines.length / secs);
      let peak = 0;
      for (const l of lines)
        peak = Math.max(peak, lines.filter((x) => x.at >= l.at && x.at < l.at + 5000).length);
      st.peak5s.push(peak);
      for (const h of humans) {
        const asked = lines.filter((l) => l.meta?.kind === 'question' && l.meta.target === h);
        if (ph.day === 1)
          st.earlyHumanQuestions += asked.filter((l) => l.at - from < 12_000).length;
        st.humanQuestionsPerDay.push(asked.length);
      }
    }
  });
  for (const v of log.filter((e): e is Ev<'verdict'> => e.type === 'verdict')) {
    if (v.guilty) st.guilty++;
    else st.innocent++;
    const d = s.players.find((p) => p.id === v.defendant);
    const side = d ? sideOf(d.role) : 'town';
    const key = `${v.guilty ? 'guilty' : 'innocent'}:${side === 'town' || side === 'mafia' ? side : 'neutral'}`;
    st.verdictsBySide[key] = (st.verdictsBySide[key] ?? 0) + 1;
  }
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${((100 * n) / d).toFixed(1)}%`);
const q = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function report(title: string, st: PacingStats): string {
  const o = st.outcomes;
  const trials = st.guilty + st.innocent;
  const by = (k: string) => st.verdictsBySide[k] ?? 0;
  return [
    `### ${title}`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Games | ${st.games} (Town ${pct(o.town ?? 0, st.games)}, Syndicate ${pct(o.mafia ?? 0, st.games)}, Cutthroat ${pct(o.cutthroat ?? 0, st.games)}, draw ${pct(o.draw ?? 0, st.games)}) |`,
    `| Voting days with a trial | ${pct(st.daysWithTrial, st.votingDays)} of ${st.votingDays} |`,
    `| Time to first trial (s) | p10 ${q(st.firstTrialSec, 0.1).toFixed(1)}, median ${q(st.firstTrialSec, 0.5).toFixed(1)}, p90 ${q(st.firstTrialSec, 0.9).toFixed(1)} |`,
    `| Trials before 8 s | ${pct(st.trialsBefore8s, st.firstTrialSec.length)} |`,
    `| Human could vote before the trial | ${pct(st.humanVoteChances, st.humanVotePlans)} of ${st.humanVotePlans} voting days |`,
    `| Verdicts guilty / innocent | ${st.guilty} / ${st.innocent} (${pct(st.guilty, trials)} guilty) |`,
    `| Guilty verdicts on Syndicate / Town / neutral | ${by('guilty:mafia')} / ${by('guilty:town')} / ${by('guilty:neutral')} |`,
    `| Innocent verdicts on Syndicate / Town / neutral | ${by('innocent:mafia')} / ${by('innocent:town')} / ${by('innocent:neutral')} |`,
    `| Public lines per second, Day 1 | mean ${avg(st.day1Rate).toFixed(2)}, p90 ${q(st.day1Rate, 0.9).toFixed(2)} |`,
    `| Public lines per second, later days | mean ${avg(st.laterRate).toFixed(2)}, p90 ${q(st.laterRate, 0.9).toFixed(2)} |`,
    `| Most lines in 5 s | median ${q(st.peak5s, 0.5)}, p90 ${q(st.peak5s, 0.9)} |`,
    `| Questions naming a human, first 12 s of Day 1 | ${st.earlyHumanQuestions} in ${st.games} games |`,
    `| Questions naming a human per discussion | mean ${avg(st.humanQuestionsPerDay).toFixed(2)}, max ${Math.max(0, ...st.humanQuestionsPerDay)} |`,
    ``,
  ].join('\n');
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const games = Number(arg('games', '200'));
  const players = Number(arg('players', '9'));
  const humans = Number(arg('humans', '1'));
  const seed = Number(arg('seed', '1'));
  const pace = arg('pace', 'fast');
  const timers = pace === 'standard' ? DEFAULT_TIMERS : FAST_TIMERS;
  const [lo, hi] = arg('human-vote', '4500-9000').split('-').map(Number) as [number, number];
  const standInStyle = {
    voteDelay: [lo, hi] as const,
    voteChance: Number(arg('human-vote-chance', '0.8')),
  };
  const st = emptyStats();
  for (let i = 0; i < games; i++) {
    measure(
      runGame({ seed: seed + i, players, humans, timers, keepState: true, standInStyle }),
      st,
    );
  }
  console.log(
    report(`${players} seats, ${humans} stand-in human(s), ${pace} pace, ${games} games`, st),
  );
}
