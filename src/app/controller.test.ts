import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../bots/llm/index.ts';
import { ClientSession } from '../net/client.ts';
import { randomId } from '../net/identity.ts';
import { createMemoryNetwork } from '../net/memory.ts';
import type { HostMessage } from '../net/protocol.ts';
import { AppController } from './controller.ts';

// Placeholder, not a real credential.
const KEY = 'placeholder-anthropic-key-for-tests';
const CLAUDE_LINE = 'Quiet night, is it not.';

function memoryStore(): KeyValueStore & { dump(): string } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => JSON.stringify([...m.entries()]),
  };
}

function fakeAnthropic(status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    if (status !== 200) {
      return new Response(
        JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
        { status },
      );
    }
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: CLAUDE_LINE }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 900, output_tokens: 12 },
      }),
      { status: 200 },
    );
  };
  return { fetch, calls };
}

function makeController(net = createMemoryNetwork(), store = memoryStore(), status = 200) {
  const anthropic = fakeAnthropic(status);
  const controller = new AppController({
    transport: () => net,
    baseUrl: 'https://theoi.github.io/vesper/',
    storage: store,
    claudeFetch: anthropic.fetch,
  });
  return { controller, net, store, anthropic };
}

async function hostWithFriend(c: AppController, net: ReturnType<typeof createMemoryNetwork>) {
  await c.hostRoom('Hana', { online: true });
  const received: HostMessage[] = [];
  const friend = new ClientSession({
    code: c.getState().session!.code,
    name: 'Ari',
    transport: net,
    token: randomId(),
    onReceive: (m) => received.push(m),
  });
  const joining = friend.join();
  await vi.advanceTimersByTimeAsync(20);
  await joining;
  c.fillWithBots(7);
  c.updateSettings({ pace: 'fast' });
  return { friend, received };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Claude bot chat glue', () => {
  it('voices bot lines with Claude, tags them by source, and never leaks the key', async () => {
    const { controller: c, net, store, anthropic } = makeController();
    const { received } = await hostWithFriend(c, net);

    c.setClaudeKey(KEY);
    await c.testClaude();
    expect(c.getState().claude.status.state).toBe('ok');
    expect(c.getState().claude.hasKey).toBe(true);
    expect(c.getState().claude.remembered).toBe(false);

    expect(c.start()).toBeNull();
    for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(1000);

    const lines = c.botTranscript();
    const voiced = lines.filter((l) => l.source === 'claude');
    expect(voiced.length).toBeGreaterThan(0);
    // Personality quirks (e.g. lowercase) may restyle Claude's line.
    const isClaudeLine = (text: string) => text.toLowerCase() === CLAUDE_LINE.toLowerCase();
    expect(voiced.every((l) => isClaudeLine(l.text) && l.delivered)).toBe(true);
    expect(lines.filter((l) => l.source === 'scripted').every((l) => l.reason)).toBe(true);
    expect(c.getState().claude.claudeLines).toBe(voiced.length);

    // Claude's words reach the remote player through the normal game events.
    const friendHeard = received.some(
      (m) => m.t === 'view' && m.view.events.some((e) => e.type === 'chat' && isClaudeLine(e.text)),
    );
    expect(friendHeard).toBe(true);

    // The key goes to Anthropic and nowhere else.
    expect(anthropic.calls.length).toBeGreaterThan(1);
    for (const call of anthropic.calls) {
      expect(call.url).toBe('https://api.anthropic.com/v1/messages');
      expect(call.headers['x-api-key']).toBe(KEY);
    }
    expect(JSON.stringify(received)).not.toContain(KEY);
    expect(JSON.stringify(c.getState())).not.toContain(KEY);
    expect(JSON.stringify(lines)).not.toContain(KEY);
    expect(store.dump()).not.toContain(KEY);
  });

  it('remembers the key only when asked, and forgets it', () => {
    const store = memoryStore();
    const { controller: c } = makeController(createMemoryNetwork(), store);
    c.setClaudeKey(KEY, { remember: true });
    expect(store.dump()).toContain(KEY);
    expect(c.getState().claude.remembered).toBe(true);

    const reloaded = makeController(createMemoryNetwork(), store).controller;
    expect(reloaded.getState().claude.hasKey).toBe(true);

    reloaded.setClaudeSettings({ model: 'claude-haiku-5-5', enabled: false });
    expect(store.dump()).toContain(KEY);
    expect(reloaded.getState().claude.status.state).toBe('off');

    reloaded.forgetClaude();
    expect(store.dump()).not.toContain(KEY);
    expect(reloaded.getState().claude.hasKey).toBe(false);
  });

  it('falls back to scripted lines and reports an invalid key', async () => {
    const { controller: c, net } = makeController(createMemoryNetwork(), memoryStore(), 401);
    await hostWithFriend(c, net);
    c.setClaudeKey(KEY);
    await c.testClaude();
    expect(c.getState().claude.status.state).toBe('invalid-key');
    c.start();
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1000);
    const lines = c.botTranscript();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.source === 'scripted' && l.delivered)).toBe(true);
    expect(lines.some((l) => l.reason === 'invalid-key')).toBe(true);
  });

  it('never calls Anthropic without a key', async () => {
    const { controller: c, net, anthropic } = makeController();
    await hostWithFriend(c, net);
    expect(c.getState().claude.status.state).toBe('off');
    c.start();
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1000);
    const lines = c.botTranscript();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.source === 'scripted' && l.reason === 'off')).toBe(true);
    expect(anthropic.calls).toHaveLength(0);
  });
});
