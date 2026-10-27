import { describe, expect, it } from 'vitest';
import { applyIntent, createGame, nextDeadline, tick } from './game.ts';
import { DEFAULT_OPTIONS } from './setup.ts';
import {
  TEST_TIMERS,
  act,
  judge,
  pinnedGame,
  putOnTrial,
  runNight,
  start,
  step,
  tryAct,
  until,
  type Driver,
} from './testkit.ts';
import type { GameEvent, PlayerId, RoleId } from './types.ts';
import { viewFor } from './view.ts';

const SIX: RoleId[] = ['resident', 'resident', 'resident', 'resident', 'resident', 'hatchet'];
const phases = (events: GameEvent[]) =>
  events.flatMap((e) => (e.type === 'phase' ? [`${e.phase}:${e.day}`] : []));

describe('phase flow', () => {
  it('runs reveal, a vote-free Day 1, night, dawn, then discussion and voting', () => {
    let d = start(pinnedGame(SIX));
    expect(d.state.phase).toMatchObject({ kind: 'reveal', day: 1, endsAt: 1000 });
    for (let i = 0; i < 6; i++) d = step(d);
    expect(phases(d.events)).toEqual([
      'discussion:1',
      'night:1',
      'dawn:2',
      'discussion:2',
      'voting:2',
      'night:2',
    ]);
  });

  it('allows Day 1 voting when the option is on', () => {
    let d = start(pinnedGame(SIX, { firstDayVoting: true }));
    d = step(step(d));
    expect(d.state.phase).toMatchObject({ kind: 'voting', day: 1 });
  });

  it('puts a player on trial the moment a majority votes for them', () => {
    let d = runNight(start(pinnedGame(SIX)), {});
    d = until(d, 'voting');
    expect(viewFor(d.state, 'p0').voteThreshold).toBe(4);
    d = putOnTrial(d, 'p5', ['p0', 'p1', 'p2']);
    expect(d.state.phase.kind).toBe('voting');
    d = act(d, 'p3', { type: 'vote', target: 'p5' });
    expect(d.state.phase.kind).toBe('defense');
    expect(d.state.trial).toMatchObject({ defendant: 'p5', number: 1 });
  });

  it('only living players may vote, and not for themselves', () => {
    let d = until(start(pinnedGame(SIX)), 'night');
    d = runNight(d, { p5: 'p0' });
    d = until(d, 'voting');
    expect(tryAct(d, 'p0', { type: 'vote', target: 'p5' })).toBeDefined();
    expect(tryAct(d, 'p1', { type: 'vote', target: 'p1' })).toBeDefined();
    expect(tryAct(d, 'p1', { type: 'vote', target: 'p0' })).toBeDefined();
  });

  it('a guilty verdict leads to last words and an execution that reveals role and will', () => {
    let d = runNight(start(pinnedGame([...SIX, 'resident'])), {});
    d = until(d, 'discussion');
    d = act(d, 'p5', { type: 'will', text: 'Not me!' });
    d = putOnTrial(d, 'p5', ['p0', 'p1', 'p2', 'p3']);
    d = judge(d, { p0: 'guilty', p1: 'guilty', p2: 'innocent', p3: 'abstain' });
    const verdict = d.events.find((e) => e.type === 'verdict');
    expect(verdict).toMatchObject({ guilty: true, guiltyWeight: 2, innocentWeight: 1 });
    expect(d.state.phase.kind).toBe('lastWords');
    expect(tryAct(d, 'p1', { type: 'chat', channel: 'public', text: 'bye' })).toBeDefined();
    d = act(d, 'p5', { type: 'chat', channel: 'public', text: 'You will regret this.' });
    d = step(d);
    expect(d.state.phase.kind).toBe('execution');
    const death = d.events.find((e) => e.type === 'death');
    expect(death).toMatchObject({
      player: 'p5',
      causes: ['executed'],
      role: 'hatchet',
      will: 'Not me!',
    });
  });

  it('a tied verdict acquits and voting resumes with the time that was left', () => {
    let d = runNight(start(pinnedGame([...SIX, 'resident'])), {});
    d = until(d, 'voting');
    const votingEnds = d.state.phase.endsAt as number;
    d = putOnTrial(d, 'p5', ['p0', 'p1', 'p2', 'p3']);
    const remaining = votingEnds - (d.state.phase.startedAt as number);
    d = judge(d, { p0: 'guilty', p1: 'innocent' });
    expect(d.events.find((e) => e.type === 'verdict')).toMatchObject({ guilty: false });
    expect(d.state.phase.kind).toBe('voting');
    expect((d.state.phase.endsAt as number) - d.state.phase.startedAt).toBe(remaining);
    expect(d.state.trialsToday).toBe(1);
  });

  it('night falls after the daily trial cap', () => {
    let d = runNight(start(pinnedGame([...SIX, 'resident'], { maxTrialsPerDay: 2 })), {});
    for (let i = 0; i < 2; i++) {
      d = putOnTrial(d, 'p5', ['p0', 'p1', 'p2', 'p3']);
      d = judge(d, { p0: 'innocent' });
    }
    expect(d.state.phase.kind).toBe('night');
  });

  it('the judgment ends early once every voter has a ballot', () => {
    let d = runNight(start(pinnedGame(SIX)), {});
    d = putOnTrial(d, 'p0', ['p1', 'p2', 'p3', 'p4']);
    d = until(d, 'judgment');
    for (const v of ['p1', 'p2', 'p3', 'p4'] as const)
      d = act(d, v, { type: 'judge', ballot: 'guilty' });
    expect(d.state.phase.kind).toBe('judgment');
    d = act(d, 'p5', { type: 'judge', ballot: 'innocent' });
    expect(d.state.phase.kind).toBe('lastWords');
  });

  it('the defendant cannot judge and only the defendant speaks during the defense', () => {
    let d = runNight(start(pinnedGame(SIX)), {});
    d = putOnTrial(d, 'p0', ['p1', 'p2', 'p3', 'p4']);
    expect(d.state.phase.kind).toBe('defense');
    expect(tryAct(d, 'p1', { type: 'chat', channel: 'public', text: 'hi' })).toBeDefined();
    d = act(d, 'p0', { type: 'chat', channel: 'public', text: 'I am innocent' });
    d = until(d, 'judgment');
    expect(tryAct(d, 'p0', { type: 'judge', ballot: 'innocent' })).toBeDefined();
  });

  it("a revealed Magistrate's vote and ballot count three times", () => {
    const roles: RoleId[] = [
      'magistrate',
      'resident',
      'resident',
      'resident',
      'resident',
      'resident',
      'hatchet',
    ];
    let d = runNight(start(pinnedGame(roles)), {});
    d = until(d, 'voting');
    d = act(d, 'p0', { type: 'vote', target: 'p6' });
    expect(d.state.phase.kind).toBe('voting');
    d = act(d, 'p0', { type: 'reveal' });
    expect(d.events.some((e) => e.type === 'magistrateReveal')).toBe(true);
    // 3 (Magistrate) + 1 reaches the threshold of 4.
    d = act(d, 'p1', { type: 'vote', target: 'p6' });
    expect(d.state.phase.kind).toBe('defense');
    d = judge(d, { p0: 'guilty', p1: 'innocent', p2: 'innocent' });
    expect(d.events.find((e) => e.type === 'verdict')).toMatchObject({
      guilty: true,
      guiltyWeight: 3,
      innocentWeight: 2,
    });
    expect(viewFor(d.state, 'p3').players[0]?.role).toBe('magistrate');
    expect(tryAct(d, 'p0', { type: 'reveal' })).toBeDefined();
  });

  it('everyone pressing ready skips discussion and night', () => {
    let d = until(start(pinnedGame(SIX)), 'discussion');
    for (const p of d.state.players) d = act(d, p.id, { type: 'ready', ready: true });
    expect(d.state.phase.kind).toBe('night');
    for (const p of d.state.players) d = act(d, p.id, { type: 'ready', ready: true });
    expect(d.state.phase.kind).toBe('dawn');
  });

  it('un-readying keeps the phase going', () => {
    let d = until(start(pinnedGame(SIX)), 'discussion');
    d = act(d, 'p0', { type: 'ready', ready: true });
    d = act(d, 'p0', { type: 'ready', ready: false });
    for (const p of d.state.players.slice(1)) d = act(d, p.id, { type: 'ready', ready: true });
    expect(d.state.phase.kind).toBe('discussion');
  });

  it('tick only advances once the timer runs out', () => {
    const d = start(pinnedGame(SIX));
    expect(tick(d.state, 999).events).toEqual([]);
    expect(tick(d.state, 999).state).toBe(d.state);
    expect(tick(d.state, 1000).state.phase.kind).toBe('discussion');
  });

  it('dawn lasts longer for each death', () => {
    const players = SIX.map((_, i) => ({ id: `p${i}`, name: `N${i}`, isBot: true }));
    const timers = { ...TEST_TIMERS, dawn: 500, dawnPerDeath: 250 };
    let { state } = createGame({ players, roles: SIX, timers, options: DEFAULT_OPTIONS }, 3, 0);
    while (state.phase.kind !== 'night') state = tick(state, state.phase.endsAt as number).state;
    const hatchet = state.players.find((p) => p.role === 'hatchet')!;
    const victim = state.players.find((p) => p.role !== 'hatchet')!;
    state = applyIntent(
      state,
      hatchet.id,
      { type: 'night', targets: [victim.id] },
      state.phase.startedAt,
    ).state;
    state = tick(state, state.phase.endsAt as number).state;
    expect(state.phase.kind).toBe('dawn');
    expect((state.phase.endsAt as number) - state.phase.startedAt).toBe(750);
  });
});

describe('trial window', () => {
  /** Day 2 voting (10 s long) with the given trial delay; omitted uses the default. */
  function voting(delay?: number): Driver {
    const s = pinnedGame(SIX);
    const { trialDelay: _, ...timers } = s.config.timers;
    s.config = {
      ...s.config,
      timers: delay === undefined ? timers : { ...timers, trialDelay: delay },
    };
    return until(runNight(start(s), {}), 'voting');
  }
  const voteAt = (d: Driver, id: PlayerId, target: PlayerId | null, at: number): Driver => {
    const r = applyIntent(d.state, id, { type: 'vote', target }, at);
    if (r.error) throw new Error(r.error);
    return { state: r.state, events: [...d.events, ...r.events] };
  };
  const MAJORITY = ['p0', 'p1', 'p2', 'p3'];

  it('a majority reached early waits for the window, then the trial starts', () => {
    let d = voting(3000);
    const opens = d.state.phase.startedAt + 3000;
    expect(viewFor(d.state, 'p0').trialOpensAt).toBe(opens);
    for (const id of MAJORITY) d = voteAt(d, id, 'p5', d.state.phase.startedAt + 500);
    expect(d.state.phase.kind).toBe('voting');
    expect(nextDeadline(d.state)).toBe(opens);
    expect(tick(d.state, opens - 1).state.phase.kind).toBe('voting');
    const after = tick(d.state, opens).state;
    expect(after.phase.kind).toBe('defense');
    expect(after.trial).toMatchObject({ defendant: 'p5', number: 1 });
    expect(viewFor(after, 'p0').trialOpensAt).toBeNull();
  });

  it('once the window is open, a majority starts the trial at once', () => {
    let d = voting(3000);
    const opens = d.state.phase.startedAt + 3000;
    for (const id of MAJORITY) d = voteAt(d, id, 'p5', opens + 10);
    expect(d.state.phase.kind).toBe('defense');
  });

  it('a majority that breaks up before the window opens starts nothing', () => {
    let d = voting(3000);
    const t0 = d.state.phase.startedAt;
    for (const id of MAJORITY) d = voteAt(d, id, 'p5', t0 + 500);
    d = voteAt(d, 'p3', null, t0 + 1000);
    expect(nextDeadline(d.state)).toBe(d.state.phase.endsAt);
    expect(tick(d.state, t0 + 3000).state.phase.kind).toBe('voting');
  });

  it('defaults to 35% of the voting time and never takes more than half of it', () => {
    const delay = (d: Driver) =>
      (viewFor(d.state, 'p0').trialOpensAt as number) - d.state.phase.startedAt;
    expect(delay(voting())).toBe(3500);
    expect(delay(voting(8000))).toBe(5000);
    const discussion = until(start(pinnedGame(SIX)), 'discussion');
    expect(viewFor(discussion.state, 'p0').trialOpensAt).toBeNull();
  });

  it('rejects a bad trial delay', () => {
    const players = SIX.map((_, i) => ({ id: `p${i}`, name: `N${i}`, isBot: true }));
    const timers = { ...TEST_TIMERS, trialDelay: -1 };
    expect(() =>
      createGame({ players, roles: SIX, timers, options: DEFAULT_OPTIONS }, 1, 0),
    ).toThrow(/trialDelay/);
  });
});
