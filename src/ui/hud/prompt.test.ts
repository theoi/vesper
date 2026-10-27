import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../../engine/index.ts';
import { promptText, trialWaitS } from './prompt.ts';

function view(over: Partial<PlayerView>): PlayerView {
  return {
    phase: { kind: 'voting', day: 2, startedAt: 0, endsAt: 20_000 },
    trialOpensAt: 7000,
    you: { id: 'a', alive: true },
    players: [],
    votes: {},
    result: null,
    ...over,
  } as PlayerView;
}

describe('trialWaitS', () => {
  it('counts whole seconds down to the trial window while voting', () => {
    expect(trialWaitS(view({}), 0)).toBe(7);
    expect(trialWaitS(view({}), 5200)).toBe(2);
    expect(trialWaitS(view({}), 6999)).toBe(1);
  });

  it('is gone once the window opens, outside voting, or without a window', () => {
    expect(trialWaitS(view({}), 7000)).toBeNull();
    expect(trialWaitS(view({ trialOpensAt: null }), 0)).toBeNull();
    const night = view({ phase: { kind: 'night', day: 2, startedAt: 0, endsAt: 20_000 } });
    expect(trialWaitS(night, 0)).toBeNull();
  });
});

describe('promptText at the end', () => {
  it('says who won and why in plain words', () => {
    const ended = view({
      phase: { kind: 'ended', day: 4, startedAt: 0, endsAt: null },
      result: { outcome: 'mafia', reason: 'mafiaParity', winners: [], day: 4 },
    });
    const text = promptText(ended, { mode: 'none', targets: [], chosen: [] });
    expect(text).toContain('prevails');
    expect(text).not.toMatch(/mafiaParity|\bmafia\b/);
  });
});
