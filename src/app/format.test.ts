import { describe, expect, it } from 'vitest';
import { runGame } from '../../scripts/simcore.ts';
import {
  DEATH_CAUSE,
  NIGHT_VERB,
  OUTCOME_HEADLINE,
  RESULT_REASON,
  SAVED_BY,
} from '../content/index.ts';
import { pinnedGame } from '../engine/testkit.ts';
import type { EventBase, GameEvent, GameEventBody, GameResult } from '../engine/types.ts';
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

const over = (outcome: GameResult['outcome'], reason: GameResult['reason']) =>
  line({
    type: 'gameOver',
    result: { outcome, reason, winners: [], day: 4 },
    roles: {},
    nights: [],
  });
const keys = <K extends string>(record: Record<K, string>) => Object.keys(record) as K[];

describe('feed lines', () => {
  it('say what a Syndicate member wants to do tonight', () => {
    const pick = (kind: 'kill' | 'frame', targets: string[] | null) =>
      line({ type: 'mafiaPick', player: 'p5', kind, targets });
    expect(pick('kill', ['p0'])).toBe('Fay wants to kill Ada.');
    expect(pick('frame', ['p0'])).toBe('Fay wants to mark Ada.');
    expect(pick('kill', null)).toBe('Fay cancels their pick.');
  });

  it('never show a raw action kind, death cause, or result id in parentheses', () => {
    const RAW = /\([a-z][A-Za-z]*\)/;
    const lines: (string | null)[] = [
      ...keys(NIGHT_VERB).map((kind) =>
        line({ type: 'mafiaPick', player: 'p5', kind, targets: ['p0'] }),
      ),
      ...keys(DEATH_CAUSE).map((cause) => death([cause])),
      ...keys(SAVED_BY).map((savedBy) =>
        line({
          type: 'nightResult',
          player: 'p1',
          night: 1,
          result: { kind: 'attackedSurvived', savedBy },
        }),
      ),
      ...keys(OUTCOME_HEADLINE).flatMap((o) => keys(RESULT_REASON).map((r) => over(o, r))),
    ];
    // Every engine event of a few real games (chat is the players' own words).
    for (const seed of [1, 2, 3]) {
      const state = runGame({ seed, players: 12, keepState: true }).state!;
      const host = viewFor(state, state.players[0]!.id);
      for (const e of state.log) if (e.type !== 'chat') lines.push(describeEvent(host, e));
    }
    expect(lines.filter((l) => l?.includes('wants to')).length).toBeGreaterThan(10);
    for (const l of lines) expect(l ?? '', l ?? '').not.toMatch(RAW);
  });

  it('say how someone died in plain words', () => {
    expect(death(['mafia'])).toBe('Ada was killed by the Syndicate. They were the Mender.');
    expect(death(['mafia', 'reckoner'])).toBe(
      'Ada was killed by the Syndicate and shot by a Reckoner. They were the Mender.',
    );
    expect(death(['guarding'])).toBe('Ada died guarding someone. They were the Mender.');
    expect(death(['executed'], true)).toBe('Ada was executed by the town. Their role is hidden.');
  });

  it('end the game with the playbill sentence', () => {
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
