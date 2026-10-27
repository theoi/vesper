import { describe, expect, it } from 'vitest';
import relayDefault from './index.ts';
import {
  ANTHROPIC_MESSAGES,
  PASSPHRASE_HEADER,
  createRelay,
  samePassphrase,
  type Env,
} from './relay.ts';

// Placeholders, not real credentials.
const KEY = 'placeholder-anthropic-key-for-relay-tests';
const PASS = 'placeholder-relay-passphrase';
const ORIGIN = 'https://theoi.github.io';
const URL_ = 'https://relay.example.workers.dev/v1/messages';

const env = (extra: Partial<Env> = {}): Env => ({
  ANTHROPIC_API_KEY: KEY,
  RELAY_PASSPHRASE: PASS,
  ...extra,
});

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function upstream(
  status = 200,
  body: unknown = { content: [{ type: 'text', text: 'Evening.' }] },
  headers: Record<string, string> = {},
) {
  const sent: Sent[] = [];
  const relay = createRelay(async (url, init) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  });
  return { relay, sent };
}

function post(
  body: unknown = { model: 'claude-haiku-5-5', max_tokens: 100, messages: [] },
  headers: Record<string, string> = {},
): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'anthropic-version': '2026-10-21',
      [PASSPHRASE_HEADER]: PASS,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function errorType(res: Response): Promise<string | undefined> {
  const json = (await res.json()) as { error?: { type?: string } };
  return json.error?.type;
}

describe('relay', () => {
  it('forwards an allowed request with the server-side key and passes the reply through', async () => {
    const { relay, sent } = upstream(
      200,
      { content: [{ type: 'text', text: 'Evening.' }] },
      {
        'request-id': 'req_1',
      },
    );
    const res = await relay.fetch(post(), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: [{ type: 'text', text: 'Evening.' }] });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('request-id')).toBe('req_1');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(ANTHROPIC_MESSAGES);
    expect(sent[0]?.headers['x-api-key']).toBe(KEY);
    expect(sent[0]?.headers['anthropic-version']).toBe('2026-10-21');
    // Nothing from the browser leaks upstream except the body and version.
    expect(Object.keys(sent[0]!.headers).sort()).toEqual([
      'anthropic-version',
      'content-type',
      'x-api-key',
    ]);
  });

  it('passes Anthropic errors and rate-limit headers through for the game to classify', async () => {
    const reset = new Date(Date.now() + 30_000).toISOString();
    const { relay } = upstream(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } },
      { 'retry-after': '12', 'anthropic-ratelimit-requests-reset': reset },
    );
    const res = await relay.fetch(post(), env());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('12');
    expect(res.headers.get('anthropic-ratelimit-requests-reset')).toBe(reset);
    expect(res.headers.get('access-control-expose-headers')).toContain('retry-after');
    expect(await errorType(res)).toBe('rate_limit_error');
  });

  it('caps max_tokens', async () => {
    const { relay, sent } = upstream();
    await relay.fetch(
      post({ model: 'claude-haiku-5-5', max_tokens: 5000, messages: [] }),
      env({ MAX_TOKENS: '200' }),
    );
    await relay.fetch(
      post({ model: 'claude-haiku-5-5', messages: [] }),
      env({ MAX_TOKENS: '200' }),
    );
    await relay.fetch(
      post({ model: 'claude-haiku-5-5', max_tokens: 50, messages: [] }),
      env({ MAX_TOKENS: '200' }),
    );
    expect(sent.map((s) => s.body.max_tokens)).toEqual([200, 200, 50]);
  });

  it.each([
    [
      'a wrong passphrase',
      post(undefined, { [PASSPHRASE_HEADER]: 'nope' }),
      env(),
      401,
      'relay_auth',
    ],
    ['no passphrase', post(undefined, { [PASSPHRASE_HEADER]: '' }), env(), 401, 'relay_auth'],
    [
      'another origin',
      post(undefined, { origin: 'https://evil.example' }),
      env(),
      403,
      'relay_origin',
    ],
    [
      'a model off the list',
      post({ model: 'claude-opus-5', max_tokens: 10, messages: [] }),
      env(),
      400,
      'relay_model',
    ],
    ['a body that is not JSON', post('{nope'), env(), 400, 'invalid_request_error'],
    [
      'streaming',
      post({ model: 'claude-haiku-5-5', stream: true, messages: [] }),
      env(),
      400,
      'invalid_request_error',
    ],
    [
      'an oversized body',
      post({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'x'.repeat(5000) }] }),
      env({ MAX_BODY_BYTES: '4096' }),
      413,
      'relay_too_large',
    ],
    ['missing secrets', post(), env({ ANTHROPIC_API_KEY: '' }), 500, 'relay_config'],
  ])('refuses %s without calling Anthropic', async (_label, req, e, status, type) => {
    const { relay, sent } = upstream();
    const res = await relay.fetch(req, e);
    expect(res.status).toBe(status);
    // The page can read the reason, so the game can show it.
    expect(res.headers.get('access-control-allow-origin')).toBe(req.headers.get('origin'));
    const text = await res.text();
    expect(JSON.parse(text).error.type).toBe(type);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(PASS);
    expect(sent).toHaveLength(0);
  });

  it('refuses requests without an origin', async () => {
    const { relay, sent } = upstream();
    const req = post();
    const bare = new Request(req, {
      headers: new Headers([...req.headers].filter(([k]) => k !== 'origin')),
    });
    const res = await relay.fetch(bare, env());
    expect(res.status).toBe(403);
    expect(await errorType(res)).toBe('relay_origin');
    expect(sent).toHaveLength(0);
  });

  it('refuses an oversized body by its declared length', async () => {
    const { relay, sent } = upstream();
    const res = await relay.fetch(post(undefined, { 'content-length': '999999' }), env());
    expect(res.status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it('applies the rate limiter', async () => {
    const { relay, sent } = upstream();
    let calls = 0;
    const LIMITER = { limit: async () => ({ success: ++calls <= 2 }) };
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await relay.fetch(post(), env({ LIMITER }))).status);
    expect(statuses).toEqual([200, 200, 429]);
    expect(sent).toHaveLength(2);
    const res = await relay.fetch(post(), env({ LIMITER }));
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await errorType(res)).toBe('rate_limit_error');
  });

  it('allows extra origins and models from its settings', async () => {
    const { relay, sent } = upstream();
    const res = await relay.fetch(
      post({ model: 'claude-sonnet-5', messages: [] }, { origin: 'http://localhost:4173' }),
      env({
        ALLOWED_ORIGINS: 'https://theoi.github.io, http://localhost:4173',
        ALLOWED_MODELS: 'claude-haiku-5-5,claude-sonnet-5',
      }),
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('answers CORS preflight, including Private Network Access', async () => {
    const res = await relayDefault.fetch(
      new Request(URL_, {
        method: 'OPTIONS',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': `content-type,anthropic-version,${PASSPHRASE_HEADER}`,
          'access-control-request-private-network': 'true',
        },
      }),
      env(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain(PASSPHRASE_HEADER);
    expect(res.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('serves a health check that says whether its secrets are set, and 404s other paths', async () => {
    const { relay } = upstream();
    const health = async (e: Env) =>
      (await relay.fetch(new Request('https://relay.example.workers.dev/'), e)).json();
    expect(await health(env())).toEqual({ service: 'vesper-claude-relay', ready: true });
    expect(await health(env({ RELAY_PASSPHRASE: '' }))).toEqual({
      service: 'vesper-claude-relay',
      ready: false,
    });
    const other = await relay.fetch(
      new Request('https://relay.example.workers.dev/v1/models'),
      env(),
    );
    expect(other.status).toBe(404);
    const get = await relay.fetch(new Request(URL_), env());
    expect(get.status).toBe(405);
  });

  it('reports an unreachable Anthropic as a server error', async () => {
    const relay = createRelay(async () => {
      throw new TypeError('fetch failed');
    });
    const res = await relay.fetch(post(), env());
    expect(res.status).toBe(502);
    expect(await errorType(res)).toBe('api_error');
  });

  it('compares passphrases exactly', async () => {
    expect(await samePassphrase(PASS, PASS)).toBe(true);
    expect(await samePassphrase(`${PASS} `, PASS)).toBe(false);
    expect(await samePassphrase('', '')).toBe(false);
  });
});
