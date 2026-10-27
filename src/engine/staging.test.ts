/**
 * The cues the stage director builds sequences from (see the README's
 * "Staging cues"). Each test pins who receives a cue and what it carries, so a
 * sequence can be chosen from one player's view without leaking anything.
 */
import { describe, expect, it } from 'vitest';
import { act, judge, pinnedGame, putOnTrial, start, step, until, type Driver } from './testkit.ts';
import type { GameEvent, GameEventType, PlayerId, RoleId } from './types.ts';
import { viewFor } from './view.ts';

const ROLES11: RoleId[] = [
  'mourner', // p0
  'mender', // p1
  'sentinel', // p2
  'resident', // p3
  'resident', // p4
  'reckoner', // p5
  'magistrate', // p6
  'patron', // p7
  'hatchet', // p8
  'embalmer', // p9
  'cutthroat', // p10
];
const IDS = ROLES11.map((_, i) => `p${i}`);
const SYNDICATE = ['p7', 'p8', 'p9'];

type Ev<T extends GameEventType> = Extract<GameEvent, { type: T }>;
const ofType = <T extends GameEventType>(events: GameEvent[], type: T): Ev<T>[] =>
  events.filter((e): e is Ev<T> => e.type === type);
const seen = (d: Driver, id: PlayerId) => viewFor(d.state, id).events;
const night = (d: Driver, picks: Record<PlayerId, PlayerId>): Driver => {
  let cur = until(d, 'night');
  for (const [actor, target] of Object.entries(picks)) {
    cur = act(cur, actor, { type: 'night', targets: [target] });
  }
  return cur;
};

// Day 1: a whisper, a Magistrate reveal, and a trial that ends innocent.
let d = until(start(pinnedGame(ROLES11, { firstDayVoting: true })), 'discussion');
d = act(d, 'p3', { type: 'whisper', to: 'p4', text: 'Watch Gus.' });
d = act(d, 'p6', { type: 'reveal' });
d = putOnTrial(d, 'p4', ['p6', 'p0', 'p1', 'p3']);
d = until(d, 'judgment');
d = act(d, 'p0', { type: 'judge', ballot: 'guilty' });
const midJudgment = d;
d = act(d, 'p0', { type: 'judge', ballot: 'innocent' });
const day1 = judge(d, { p1: 'innocent', p6: 'innocent' });
// Night 1: the Patron's order beats the Hatchet's pick and is healed; the
// Cutthroat runs into a Sentinel; the Embalmer closes the Cutthroat's coffin.
const night1 = night(day1, {
  p7: 'p3',
  p8: 'p4',
  p1: 'p3',
  p2: 'p4',
  p10: 'p4',
  p9: 'p10',
});
const dawn2 = step(night1);
// Night 2: the dead and the Mourner talk; the Reckoner and the Syndicate both kill.
let n2 = night(dawn2, { p5: 'p8', p7: 'p6' });
n2 = act(n2, 'p2', { type: 'chat', channel: 'dead', text: 'Mourner, the Cutthroat is gone.' });
n2 = act(n2, 'p0', { type: 'chat', channel: 'dead', text: 'Who took you?' });
const dawn3 = step(n2);
// Day 3: the Embalmer is executed.
const lastWords = judge(putOnTrial(dawn3, 'p9', ['p0', 'p1', 'p3', 'p4']), {
  p0: 'guilty',
  p1: 'guilty',
  p3: 'guilty',
  p4: 'guilty',
});
const executed = until(lastWords, 'execution');

describe('staging cues', () => {
  it('role deal: each player gets only their own role; the Syndicate also gets teammates', () => {
    for (const id of IDS) {
      const deals = ofType(seen(d, id), 'roleAssigned');
      expect(deals).toHaveLength(1);
      expect(deals[0]).toMatchObject({ player: id, audience: [id] });
      if (SYNDICATE.includes(id)) {
        expect(deals[0]?.teammates?.map((t) => t.id).sort()).toEqual(
          SYNDICATE.filter((x) => x !== id),
        );
      } else {
        expect(deals[0]?.teammates).toBeUndefined();
      }
    }
  });

  it('day: whisper notices, votes, trials, ballots, verdicts, and reveals reach everyone', () => {
    for (const id of IDS) {
      const ev = seen(day1, id);
      expect(ofType(ev, 'whisperNotice')).toEqual([
        expect.objectContaining({ from: 'p3', to: 'p4', audience: 'all' }),
      ]);
      expect(ofType(ev, 'magistrateReveal')).toEqual([expect.objectContaining({ player: 'p6' })]);
      expect(ofType(ev, 'vote').map((v) => [v.voter, v.weight])).toEqual([
        ['p6', 3],
        ['p0', 1],
        ['p1', 1],
        ['p3', 1],
      ]);
      expect(ofType(ev, 'trial')).toEqual([
        expect.objectContaining({ defendant: 'p4', number: 1 }),
      ]);
      expect(ofType(ev, 'verdict')[0]).toMatchObject({ guilty: false, innocentWeight: 5 });
      const whispered = ofType(ev, 'chat').some((c) => c.channel === 'whisper');
      expect(whispered).toBe(id === 'p3' || id === 'p4');
    }
  });

  it('ballots: each cast or change is public, the choice is not, until the verdict', () => {
    const casts = ofType(seen(midJudgment, 'p10'), 'ballotCast');
    expect(casts).toEqual([expect.objectContaining({ voter: 'p0', audience: 'all' })]);
    expect(Object.keys(casts[0] ?? {})).not.toContain('ballot');
    expect(JSON.stringify(viewFor(midJudgment.state, 'p10').trial)).not.toContain('guilty');
    // A changed ballot casts again: one stomp per change, not per voter.
    const all = ofType(seen(day1, 'p10'), 'ballotCast').map((b) => b.voter);
    expect(all).toEqual(['p0', 'p0', 'p1', 'p6']);
  });

  it("night: your own pick is private; teammates' picks reach only the living Syndicate", () => {
    for (const id of IDS) {
      const ev = seen(night1, id);
      for (const e of ofType(ev, 'nightActionSet')) expect(e.player).toBe(id);
      const picks = ofType(ev, 'mafiaPick').map((p) => [p.player, p.targets?.[0]]);
      if (SYNDICATE.includes(id)) {
        expect(picks).toEqual([
          ['p7', 'p3'],
          ['p8', 'p4'],
          ['p9', 'p10'],
        ]);
      } else {
        expect(picks).toEqual([]);
      }
    }
  });

  it('dawn: deaths, causes, and closed coffins are public, in the same batch as the phase', () => {
    const batch = dawn2.events.slice(night1.events.length);
    expect(batch.map((e) => e.type).slice(0, 4)).toEqual(['phase', 'death', 'death', 'dawn']);
    for (const id of IDS) {
      const ev = seen(dawn2, id);
      expect(ofType(ev, 'dawn').at(-1)).toMatchObject({ deaths: ['p2', 'p10'], day: 2 });
      const deaths = ofType(ev, 'death');
      expect(deaths.find((x) => x.player === 'p2')).toMatchObject({
        causes: ['guarding'],
        role: 'sentinel',
        embalmed: false,
      });
      expect(deaths.find((x) => x.player === 'p10')).toMatchObject({
        causes: ['sentinel'],
        role: null,
        will: null,
        embalmed: true,
      });
    }
    // Only the Embalmer learns what the closed coffin holds.
    const embalmed = (id: PlayerId) =>
      ofType(seen(dawn2, id), 'nightResult').filter((r) => r.result.kind === 'embalmed');
    expect(embalmed('p9')[0]?.result).toMatchObject({ target: 'p10', role: 'cutthroat' });
    for (const id of IDS.filter((x) => x !== 'p9')) expect(embalmed(id)).toEqual([]);
  });

  it('saves are private to the attacked player and the healer or guard', () => {
    const results = (id: PlayerId) =>
      ofType(seen(dawn2, id), 'nightResult')
        .filter((r) => r.night === 1)
        .map((r) => r.result);
    expect(results('p3')).toContainEqual({ kind: 'attackedSurvived', savedBy: 'healed' });
    expect(results('p1')).toContainEqual({ kind: 'patientAttacked', target: 'p3', saved: true });
    expect(results('p4')).toContainEqual({ kind: 'attackedSurvived', savedBy: 'guarded' });
    expect(results('p2')).toContainEqual({ kind: 'guardFought', target: 'p4' });
    expect(results('p8')).toContainEqual({ kind: 'targetSurvived', target: 'p3' });
    for (const id of IDS) {
      for (const e of ofType(seen(dawn2, id), 'nightResult')) expect(e.player).toBe(id);
    }
    for (const id of ['p0', 'p5', 'p6', 'p7']) expect(results(id)).toEqual([]);
  });

  it('kill sources: Syndicate and Reckoner deaths name their cause for everyone', () => {
    for (const id of IDS) {
      const deaths = ofType(seen(dawn3, id), 'death').filter((x) => x.day === 3);
      expect(deaths.map((x) => [x.player, x.causes])).toEqual([
        ['p6', ['mafia']],
        ['p8', ['reckoner']],
      ]);
    }
  });

  it('Mourner contact: night dead chat reaches only the dead and the living Mourner', () => {
    const contact = (id: PlayerId) =>
      ofType(seen(dawn3, id), 'chat').filter(
        (c) => c.channel === 'dead' && c.phase === 'night' && c.day === 2,
      );
    expect(contact('p0').map((c) => [c.from, c.fromLabel])).toEqual([
      ['p2', undefined],
      ['p0', 'the Mourner'],
    ]);
    for (const id of ['p2', 'p10']) {
      expect(contact(id).map((c) => [c.from, c.fromLabel])).toEqual([
        ['p2', undefined],
        [null, 'the Mourner'],
      ]);
    }
    for (const id of ['p1', 'p3', 'p4', 'p5', 'p7', 'p9']) expect(contact(id)).toEqual([]);
  });

  it('last words and execution: the defendant stays on the trial view, and the cause is public', () => {
    expect(lastWords.state.phase.kind).toBe('lastWords');
    expect(viewFor(lastWords.state, 'p3').trial?.defendant).toBe('p9');
    for (const id of IDS) {
      expect(ofType(seen(executed, id), 'death').at(-1)).toMatchObject({
        player: 'p9',
        time: 'day',
        causes: ['executed'],
        role: 'embalmer',
      });
    }
  });
});
