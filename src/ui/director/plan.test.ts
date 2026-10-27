import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventBody, PlayerView } from '../../engine/index.ts';
import { newMemo, pickVariant, plan, type SeqSpec } from './plan.ts';

let seq = 0;
function ev(body: GameEventBody, at = 1000 + seq * 10, day = 2): GameEvent {
  seq += 1;
  return { seq, at, day, phase: 'night', audience: 'all', ...body } as GameEvent;
}

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    you: { id: 'a', faction: 'town', alive: true, role: 'augur' },
    players: ['a', 'b', 'c', 'd'].map((id, seat) => ({
      id,
      name: id.toUpperCase(),
      seat,
      alive: true,
    })),
    voteThreshold: 3,
    graveyard: [],
    ...over,
  } as PlayerView;
}

function seqs(steps: ReturnType<typeof plan>): SeqSpec[] {
  return steps.flatMap((s) => (s.kind === 'seq' ? [s.seq] : []));
}

describe('pickVariant', () => {
  it('never picks the same variant twice in a row for one kind', () => {
    const memo = newMemo('room');
    let prev: string | null = null;
    for (let i = 0; i < 200; i++) {
      const v = pickVariant(memo, 'nightfall', `salt${i}`, ['lamps', 'fog', 'lantern']);
      expect(v).not.toBe(prev);
      prev = v;
    }
  });

  it('gives every client in a room the same sequence of variants', () => {
    const a = newMemo('room-1');
    const b = newMemo('room-1');
    const salts = Array.from({ length: 30 }, (_, i) => `${i}:${i * 977}`);
    const runA = salts.map((s) => pickVariant(a, 'guilty', s, ['poly', 'slam', 'flare']));
    const runB = salts.map((s) => pickVariant(b, 'guilty', s, ['poly', 'slam', 'flare']));
    expect(runA).toEqual(runB);
    expect(new Set(runA).size).toBe(3);
  });
});

describe('plan', () => {
  it('folds a night of deaths and private results into one dawn sequence', () => {
    const memo = newMemo('k');
    const steps = plan(
      [
        ev({ type: 'phase', phase: 'dawn', day: 2, endsAt: 0 }),
        ev({
          type: 'death',
          player: 'b',
          time: 'night',
          causes: ['mafia'],
          role: 'mender',
          will: 'x',
          deathNotes: [],
          embalmed: false,
        }),
        ev({ type: 'dawn', deaths: ['b'] }),
        ev({
          type: 'nightResult',
          player: 'a',
          night: 1,
          result: { kind: 'investigation', target: 'c', finding: 'suspicious' },
        }),
      ],
      view(),
      memo,
    );
    const out = seqs(steps);
    expect(out).toHaveLength(1);
    const dawn = out[0];
    expect(dawn?.id).toBe('dawn');
    if (dawn?.id !== 'dawn') return;
    expect(dawn.variant).toBe('one');
    expect(dawn.deaths.map((d) => [d.player, d.staging])).toEqual([['b', 'mafia']]);
    expect(dawn.notes.map((n) => n.text)).toEqual(['C: Suspicious']);
    expect(memo.lastDawnDeaths).toBe(1);
  });

  it('opens the next day in mourning after deaths, and quietly after none', () => {
    const memo = newMemo('k');
    memo.lastDawnDeaths = 2;
    const mourning = seqs(
      plan([ev({ type: 'phase', phase: 'discussion', day: 3, endsAt: 0 })], view(), memo),
    );
    expect(mourning[0]).toMatchObject({ id: 'dayOpen', variant: 'mourning' });
    plan([ev({ type: 'dawn', deaths: [] })], view(), memo);
    const quiet = seqs(
      plan([ev({ type: 'phase', phase: 'discussion', day: 4, endsAt: 0 })], view(), memo),
    );
    expect(quiet[0]).toMatchObject({ id: 'dayOpen', variant: 'quiet' });
  });

  it('stages an execution together with the death it causes', () => {
    const out = seqs(
      plan(
        [
          ev({ type: 'phase', phase: 'execution', day: 2, endsAt: 0 }),
          ev({
            type: 'death',
            player: 'c',
            time: 'day',
            causes: ['executed'],
            role: 'patron',
            will: '',
            deathNotes: [],
            embalmed: false,
          }),
        ],
        view(),
        newMemo('k'),
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'execution',
      player: 'c',
      death: { staging: 'executed', role: 'patron' },
    });
  });

  it('deals only your own role, by faction', () => {
    const out = seqs(
      plan(
        [
          ev({ type: 'roleAssigned', player: 'b', role: 'patron' }),
          ev({
            type: 'roleAssigned',
            player: 'a',
            role: 'hatchet',
            teammates: [{ id: 'd', role: 'patron' }],
          }),
        ],
        view(),
        newMemo('k'),
      ),
    );
    expect(out).toEqual([
      { id: 'deal', tone: 'mafia', role: 'hatchet', teammates: ['d'], changed: false },
    ]);
  });

  it("reaches the Mourner's hand through the cloth only for the Mourner's night lines", () => {
    const beats = (steps: ReturnType<typeof plan>) =>
      steps.flatMap((s) => (s.kind === 'beat' ? [s.beat] : []));
    const line = (from: string | null, phase: 'night' | 'discussion' = 'night') =>
      ({
        ...ev({ type: 'chat', channel: 'dead', from, text: 'who came?', fromLabel: 'the Mourner' }),
        phase,
      }) as GameEvent;
    const dead = view({ you: { id: 'a', faction: 'town', alive: false, role: 'augur' } } as never);
    expect(beats(plan([line(null)], dead, newMemo('k')))).toEqual([
      { type: 'mourner', text: 'who came?' },
    ]);
    expect(beats(plan([line('b')], dead, newMemo('k')))).toEqual([]);
    expect(beats(plan([line(null, 'discussion')], dead, newMemo('k')))).toEqual([]);
    const mourner = view({
      you: { id: 'a', faction: 'town', alive: true, role: 'mourner' },
    } as never);
    expect(beats(plan([line('a')], mourner, newMemo('k')))).toEqual([
      { type: 'mourner', text: 'who came?' },
    ]);
  });
});
