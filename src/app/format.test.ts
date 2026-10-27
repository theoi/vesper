import { describe, expect, it } from 'vitest';
import { pinnedGame } from '../engine/testkit.ts';
import type { EventBase, GameEvent, GameEventBody } from '../engine/types.ts';
import { viewFor } from '../engine/view.ts';
import { describeEvent } from './format.ts';

const view = viewFor(
  pinnedGame(['mender', 'resident', 'resident', 'resident', 'resident', 'hatchet']),
  'p1',
);
const base: EventBase = { seq: 1, at: 0, day: 2, phase: 'dawn', audience: 'all' };
const line = (body: GameEventBody) => describeEvent(view, { ...base, ...body } as GameEvent);
const death = (causes: Extract<GameEventBody, { type: 'death' }>['causes'], embalmed = false) =>
  line({
    type: 'death',
    player: 'p0',
    time: 'night',
    causes,
    role: embalmed ? null : 'mender',
    will: null,
    deathNotes: [],
    embalmed,
  });

describe('feed lines', () => {
  it('say how someone died in plain words', () => {
    expect(death(['mafia'])).toBe('Ada was killed by the Syndicate. They were the Mender.');
    expect(death(['mafia', 'reckoner'])).toBe(
      'Ada was killed by the Syndicate and shot by a Reckoner. They were the Mender.',
    );
    expect(death(['guarding'])).toBe('Ada died guarding someone. They were the Mender.');
    expect(death(['executed'], true)).toBe('Ada was executed by the town. Their role is hidden.');
  });

  it('end the game with the playbill sentence', () => {
    const over = (outcome: 'town' | 'mafia', reason: 'threatsEliminated' | 'mafiaParity') =>
      line({
        type: 'gameOver',
        result: { outcome, reason, winners: [], day: 4 },
        roles: {},
        nights: [],
      });
    expect(over('town', 'threatsEliminated')).toBe(
      'Game over. The Town prevails: every threat to the town is gone.',
    );
    expect(over('mafia', 'mafiaParity')).toBe(
      'Game over. The Syndicate prevails: the Syndicate has the numbers now.',
    );
  });

  it('tell a survivor what saved them', () => {
    const saved = line({
      type: 'nightResult',
      player: 'p1',
      night: 1,
      result: { kind: 'attackedSurvived', savedBy: 'healed' },
    });
    expect(saved).toBe('Night 1: You were attacked, but a Mender saved your life.');
  });
});
