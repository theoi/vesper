import { describe, expect, it } from 'vitest';
import type { GameEvent, NightAction, PlayerView } from '../../engine/index.ts';
import { deathsLine, describeAction, nightsOf } from './history.ts';

const NAMES: Record<string, string> = { a: 'Ada', b: 'Bram', c: 'Cass', d: 'Dov', e: 'Esme' };
const name = (id: string) => NAMES[id] ?? id;
const act = (over: Partial<NightAction>): NightAction => ({
  actor: 'a',
  role: 'hatchet',
  kind: 'kill',
  target: 'b',
  outcome: 'killed',
  ...over,
});

describe('describeAction', () => {
  it.each<[Partial<NightAction>, string]>([
    [{}, 'Ada the Hatchet killed Bram.'],
    [{ role: 'patron', outcome: 'ordered' }, 'Ada the Patron ordered the kill on Bram.'],
    [
      { chose: 'c' },
      "Ada the Hatchet killed Bram. (It was the Patron's order; their own pick was Cass.)",
    ],
    [
      { role: 'cutthroat', kind: 'stab', outcome: 'survived', chose: 'c' },
      'Ada the Cutthroat went for Bram, who lived through it. (Bram had come to distract them.)',
    ],
    [
      { role: 'reckoner', kind: 'shoot', outcome: 'intercepted' },
      'Ada the Reckoner shot at Bram, but a Sentinel took the blow.',
    ],
    [
      { role: 'augur', kind: 'investigate', outcome: 'suspicious' },
      'Ada the Augur read Bram: suspicious.',
    ],
    [
      { role: 'lamplighter', kind: 'watch', outcome: 'watched', visitors: ['c', 'd', 'e'] },
      "Ada the Lamplighter watched Bram's door and saw Cass, Dov and Esme.",
    ],
    [
      { role: 'lamplighter', kind: 'watch', outcome: 'watched', visitors: [] },
      "Ada the Lamplighter watched Bram's door and saw nobody.",
    ],
    [
      { role: 'mender', kind: 'heal', outcome: 'saved' },
      'Ada the Mender tended Bram and saved their life.',
    ],
    [
      { role: 'sentinel', kind: 'guard', outcome: 'quiet' },
      'Ada the Sentinel guarded Bram. Nobody came.',
    ],
    [
      { role: 'muse', kind: 'block', outcome: 'resisted' },
      'Ada the Muse tried to distract Bram, who would not be kept.',
    ],
    [{ role: 'slanderer', kind: 'frame', outcome: 'framed' }, 'Ada the Slanderer framed Bram.'],
    [
      { role: 'embalmer', kind: 'embalm', outcome: 'quiet' },
      'Ada the Embalmer waited to embalm Bram, but Bram lived.',
    ],
    [
      { role: 'drifter', kind: 'vest', target: 'a', outcome: 'armored' },
      'Ada the Drifter slept in armor.',
    ],
    [
      { role: 'augur', kind: 'investigate', outcome: 'blocked' },
      'Ada the Augur set out for Bram but was distracted and never arrived.',
    ],
  ])('%o', (over, expected) => {
    expect(describeAction(act(over), name)).toBe(expected);
  });
});

describe('nightsOf and deathsLine', () => {
  const nights = [
    { night: 1, actions: [act({})], deaths: ['b'] },
    { night: 2, actions: [], deaths: [] },
  ];
  const gameOver = {
    type: 'gameOver',
    seq: 9,
    at: 0,
    day: 3,
    phase: 'ended',
    audience: 'all',
    result: { outcome: 'mafia', winners: ['a'], reason: 'mafiaParity', day: 3 },
    roles: {},
    nights,
  } as unknown as GameEvent;

  it('reads the record from gameOver and is empty before the game ends', () => {
    expect(nightsOf({ events: [gameOver] } as unknown as PlayerView)).toBe(nights);
    expect(nightsOf({ events: [] } as unknown as PlayerView)).toEqual([]);
  });

  it('names the dead, or says nobody died', () => {
    expect(deathsLine({ night: 1, actions: [], deaths: ['b', 'c'] }, name)).toBe(
      'Bram and Cass died.',
    );
    expect(deathsLine(nights[1]!, name)).toBe('Nobody died.');
  });
});
