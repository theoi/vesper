import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../../engine/types.ts';
import type { BotSpeech } from '../types.ts';
import { relayEndpoint, type FetchLike } from './client.ts';
import { ChatLayer } from './layer.ts';
import { loadSettings, saveSettings, type KeyValueStore } from './settings.ts';

// Placeholders, not real credentials.
const KEY = 'placeholder-anthropic-key-for-tests';
const PASS = 'placeholder-relay-passphrase';
const RELAY = 'https://vesper-relay.example.workers.dev';

interface Call {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return reply();
  };
  return { fetch, calls };
}

const ok = () =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text: 'ready' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 1 },
    }),
    { status: 200 },
  );

const relayError =
  (status: number, type: string, message = 'nope') =>
  () =>
    new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status });

function relayLayer(fetch: FetchLike, extra = {}) {
  return new ChatLayer({
    fetch,
    apiKey: KEY,
    mode: 'relay',
    relayUrl: RELAY,
    relayPassphrase: PASS,
    ...extra,
  });
}

describe('relayEndpoint', () => {
  it.each([
    [RELAY, `${RELAY}/v1/messages`],
    [`${RELAY}/`, `${RELAY}/v1/messages`],
    [`  ${RELAY}/v1/messages  `, `${RELAY}/v1/messages`],
    [`${RELAY}/?x=1#y`, `${RELAY}/v1/messages`],
    ['https://example.com/relay', 'https://example.com/relay/v1/messages'],
    ['http://localhost:8787', 'http://localhost:8787/v1/messages'],
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787/v1/messages'],
  ])('%s → %s', (input, out) => {
    expect(relayEndpoint(input)).toBe(out);
  });

  it.each([
    'http://relay.example.com',
    'relay.example.com',
    'not a url',
    'https://u:p@relay.example.com',
  ])('refuses %s', (input) => {
    expect(relayEndpoint(input)).toBeNull();
  });
});

describe('relay mode', () => {
  it('sends the passphrase to the relay and never the key', async () => {
    const { fetch, calls } = fakeFetch(ok);
    const layer = relayLayer(fetch);
    expect(layer.settings).toMatchObject({ mode: 'relay', hasRelay: true, ready: true });
    const status = await layer.check();
    expect(status.state).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${RELAY}/v1/messages`);
    expect(calls[0]?.headers['x-relay-passphrase']).toBe(PASS);
    expect(calls[0]?.headers).not.toHaveProperty('x-api-key');
    expect(calls[0]?.headers).not.toHaveProperty('anthropic-dangerous-direct-browser-access');
    expect(JSON.stringify(calls)).not.toContain(KEY);
  });

  it('is off until both the URL and passphrase are set, whatever the key', () => {
    const { fetch } = fakeFetch(ok);
    const layer = new ChatLayer({ fetch, apiKey: KEY, mode: 'relay', relayUrl: RELAY });
    expect(layer.settings.ready).toBe(false);
    expect(layer.status()).toMatchObject({ state: 'off', detail: expect.stringMatching(/relay/) });
    layer.configure({ mode: 'key' });
    expect(layer.settings.ready).toBe(true);
  });

  it('flags a URL that is not https', () => {
    const { fetch, calls } = fakeFetch(ok);
    const layer = relayLayer(fetch, { relayUrl: 'http://relay.example.com' });
    expect(layer.status().state).toBe('relay-error');
    expect(calls).toHaveLength(0);
  });

  it.each([
    [relayError(401, 'relay_auth'), 'relay-error', /passphrase/],
    [relayError(403, 'relay_origin'), 'relay-error', /ALLOWED_ORIGINS/],
    [relayError(500, 'relay_config'), 'relay-error', /ANTHROPIC_API_KEY or RELAY_PASSPHRASE/],
    [relayError(400, 'relay_model'), 'degraded', /ALLOWED_MODELS/],
    [
      relayError(401, 'authentication_error', 'invalid x-api-key'),
      'invalid-key',
      /relay's ANTHROPIC_API_KEY/,
    ],
    [
      () => {
        throw new TypeError('Failed to fetch');
      },
      'relay-error',
      /Could not reach the relay at vesper-relay\.example\.workers\.dev/,
    ],
  ])('explains relay problem %#', async (reply, state, detail) => {
    const { fetch } = fakeFetch(reply);
    const status = await relayLayer(fetch).check();
    expect(status.state).toBe(state);
    expect(status.detail).toMatch(detail);
    expect(status.detail).not.toContain(PASS);
  });

  it('falls back to scripted lines while the relay refuses', async () => {
    const { fetch, calls } = fakeFetch(relayError(401, 'relay_auth'));
    const layer = relayLayer(fetch);
    await layer.check();
    const speech = {
      category: 'accuse',
      intent: { type: 'chat', channel: 'public', text: 'I suspect Wren.' },
    } as unknown as BotSpeech;
    const r = await layer.rewrite({} as PlayerView, speech);
    expect(r).toMatchObject({ source: 'scripted', reason: 'relay-error', text: 'I suspect Wren.' });
    expect(calls).toHaveLength(1);
  });
});

describe('relay settings storage', () => {
  function store(): KeyValueStore & { dump(): string } {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      dump: () => JSON.stringify([...m]),
    };
  }

  it('stores the relay only when asked to remember it, and the mode always', () => {
    const s = store();
    saveSettings(s, { mode: 'relay', relayUrl: RELAY, relayPassphrase: PASS });
    expect(s.dump()).not.toContain(PASS);
    expect(loadSettings(s)).toEqual({ mode: 'relay' });
    saveSettings(s, { mode: 'relay', relayUrl: RELAY, relayPassphrase: PASS }, true);
    expect(loadSettings(s)).toEqual({ mode: 'relay', relayUrl: RELAY, relayPassphrase: PASS });
    // Saving other settings leaves the remembered relay alone.
    saveSettings(s, { model: 'claude-haiku-5-5' });
    expect(loadSettings(s).relayPassphrase).toBe(PASS);
  });
});
