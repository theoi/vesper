import { describe, expect, it } from 'vitest';
import { runGame } from './simcore.ts';

describe('headless simulation', () => {
  it('bot-only games end cleanly with no invariant violations or rejected intents', () => {
    for (let i = 0; i < 27; i++) {
      const r = runGame({ seed: 900 + i, players: 7 + (i % 9) });
      expect(r.violations, `seed ${r.seed}`).toEqual([]);
      expect(r.ended).toBe(true);
      expect(r.rejected, `seed ${r.seed}: ${r.rejectedSamples.join(' | ')}`).toBe(0);
      expect(r.chatLines).toBeGreaterThan(10);
    }
  });

  it('is deterministic per seed', () => {
    const a = runGame({ seed: 42, players: 11, keepState: true });
    const b = runGame({ seed: 42, players: 11, keepState: true });
    expect(a.state?.log).toEqual(b.state?.log);
  });

  it('chat stays varied within a game', () => {
    const r = runGame({ seed: 7, players: 12, keepState: true });
    const lines = (r.state?.log ?? []).flatMap((e) => (e.type === 'chat' ? [e.text] : []));
    expect(lines.length).toBeGreaterThan(50);
    expect(new Set(lines).size / lines.length).toBeGreaterThan(0.7);
  });
});
