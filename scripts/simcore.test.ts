import { describe, expect, it } from 'vitest';
import { ChatLayer } from '../src/bots/llm/index.ts';
import { viewFor } from '../src/engine/index.ts';
import { runGame, runGameAsync } from './simcore.ts';

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

  it('games stay clean when every line goes through the Claude chat layer', async () => {
    // A stand-in model that rewrites each draft a little and sometimes breaks a rule.
    let n = 0;
    const layer = new ChatLayer({
      apiKey: 'test-key-for-headless-run',
      maxCallsPerMinute: 100_000,
      fetch: async (_url, init) => {
        const user = (JSON.parse(String(init.body)) as { messages: { content: string }[] })
          .messages[0]?.content;
        const draft = /^Draft: (.*)$/m.exec(user ?? '')?.[1] ?? '';
        const text = ++n % 10 === 0 ? 'As an AI, I cannot say.' : `Honestly? ${draft}`;
        return new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: {} }));
      },
    });
    const r = await runGameAsync({ seed: 77, players: 9, keepState: true }, async (turn) => {
      const out = await layer.rewrite(viewFor(turn.state, turn.botId), turn.speech);
      return { ...turn.speech.intent, text: out.text };
    });
    expect(r.violations).toEqual([]);
    expect(r.ended).toBe(true);
    expect(r.rejected).toBe(0);
    const m = layer.metrics();
    expect(m.claude).toBeGreaterThan(50);
    expect(m.guardrail.meta).toBeGreaterThan(0);
    const chat = (r.state?.log ?? []).flatMap((e) => (e.type === 'chat' ? [e.text] : []));
    expect(chat.some((t) => t.startsWith('Honestly?'))).toBe(true);
    expect(chat.some((t) => t.includes('As an AI'))).toBe(false);
  });
});
