/**
 * Vesper Claude relay: a small Cloudflare Worker that forwards the game's
 * Claude requests to Anthropic with a key that stays on the server.
 *
 * - Holds ANTHROPIC_API_KEY and RELAY_PASSPHRASE as Worker secrets.
 * - Accepts only POST /v1/messages from allowed origins, with the passphrase
 *   in the x-relay-passphrase header.
 * - Enforces a model allowlist, a max_tokens cap, and a body size limit.
 * - Passes Anthropic's status, error body, and rate-limit headers through, so
 *   the game reacts the same way it does to a direct call.
 * - Logs nothing.
 */

/** Cloudflare's rate limiting binding (see wrangler.jsonc). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ANTHROPIC_API_KEY?: string;
  RELAY_PASSPHRASE?: string;
  /** Comma-separated origins allowed to call the relay. */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated model ids the relay will forward. */
  ALLOWED_MODELS?: string;
  /** Upper bound for max_tokens; larger requests are lowered to it. */
  MAX_TOKENS?: string;
  /** Largest request body accepted, in bytes. */
  MAX_BODY_BYTES?: string;
  LIMITER?: RateLimiter;
}

export const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';
export const PASSPHRASE_HEADER = 'x-relay-passphrase';
export const DEFAULTS = {
  origins: 'https://theoi.github.io',
  models: 'claude-haiku-5-5',
  maxTokens: 300,
  maxBodyBytes: 64 * 1024,
};

const DEFAULT_VERSION = '2023-06-01';
const ALLOW_HEADERS = `content-type, anthropic-version, anthropic-beta, ${PASSPHRASE_HEADER}`;
/** Response headers the game reads (rate-limit timing) or that help debugging. */
const PASSED_HEADERS = [
  'retry-after',
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-reset',
  'request-id',
];

type Upstream = (url: string, init: RequestInit) => Promise<Response>;

function list(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function corsHeaders(origin: string | null): Headers {
  const h = new Headers({
    vary: 'origin',
    'access-control-expose-headers': PASSED_HEADERS.join(', '),
  });
  // Echo any origin so the page can read the relay's error message. Disallowed
  // origins are still refused before anything is forwarded.
  if (origin) h.set('access-control-allow-origin', origin);
  return h;
}

function error(status: number, type: string, message: string, headers: Headers): Response {
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers,
  });
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Constant-time comparison of the given passphrase with the secret. */
export async function samePassphrase(given: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0 && given.length > 0;
}

function preflight(request: Request, origin: string | null): Response {
  const h = corsHeaders(origin);
  h.set('access-control-allow-methods', 'POST, OPTIONS');
  h.set('access-control-allow-headers', ALLOW_HEADERS);
  h.set('access-control-max-age', '86400');
  h.append('vary', 'access-control-request-private-network');
  // Chrome's Private Network Access check, for pages that call a relay on localhost.
  if (request.headers.get('access-control-request-private-network') === 'true') {
    h.set('access-control-allow-private-network', 'true');
  }
  return new Response(null, { status: 204, headers: h });
}

export function createRelay(upstream: Upstream = (url, init) => fetch(url, init)) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      if (request.method === 'OPTIONS') return preflight(request, origin);
      const cors = corsHeaders(origin);
      if (url.pathname === '/' && request.method === 'GET') {
        cors.set('content-type', 'application/json');
        const ready = !!env.ANTHROPIC_API_KEY && !!env.RELAY_PASSPHRASE;
        return new Response(JSON.stringify({ service: 'vesper-claude-relay', ready }), {
          headers: cors,
        });
      }
      if (url.pathname !== '/v1/messages') {
        return error(404, 'not_found_error', 'This relay only serves POST /v1/messages.', cors);
      }
      if (request.method !== 'POST') {
        return error(405, 'invalid_request_error', 'Use POST.', cors);
      }
      if (!env.ANTHROPIC_API_KEY || !env.RELAY_PASSPHRASE) {
        return error(
          500,
          'relay_config',
          'The relay is missing its ANTHROPIC_API_KEY or RELAY_PASSPHRASE secret.',
          cors,
        );
      }
      const origins = list(env.ALLOWED_ORIGINS, DEFAULTS.origins);
      if (!origin || !origins.includes(origin)) {
        return error(
          403,
          'relay_origin',
          `This relay does not accept requests from ${origin ?? 'pages without an origin'}. Add it to ALLOWED_ORIGINS.`,
          cors,
        );
      }
      if (
        !(await samePassphrase(request.headers.get(PASSPHRASE_HEADER) ?? '', env.RELAY_PASSPHRASE))
      ) {
        return error(401, 'relay_auth', 'Wrong relay passphrase.', cors);
      }
      if (env.LIMITER && !(await env.LIMITER.limit({ key: 'messages' })).success) {
        cors.set('retry-after', '60');
        return error(
          429,
          'rate_limit_error',
          'The relay is over its per-minute request limit.',
          cors,
        );
      }

      const maxBody = positive(env.MAX_BODY_BYTES, DEFAULTS.maxBodyBytes);
      const tooLarge = () =>
        error(413, 'relay_too_large', `Request bodies over ${maxBody} bytes are refused.`, cors);
      if (Number(request.headers.get('content-length') ?? 0) > maxBody) return tooLarge();
      const raw = new Uint8Array(await request.arrayBuffer());
      if (raw.byteLength > maxBody) return tooLarge();
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
          throw new Error();
        body = parsed as Record<string, unknown>;
      } catch {
        return error(400, 'invalid_request_error', 'The request body must be a JSON object.', cors);
      }
      const models = list(env.ALLOWED_MODELS, DEFAULTS.models);
      if (typeof body.model !== 'string' || !models.includes(body.model)) {
        return error(
          400,
          'relay_model',
          `This relay only allows these models: ${models.join(', ')}.`,
          cors,
        );
      }
      if (body.stream === true) {
        return error(400, 'invalid_request_error', 'This relay does not stream.', cors);
      }
      const cap = positive(env.MAX_TOKENS, DEFAULTS.maxTokens);
      const asked =
        typeof body.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : cap;
      body.max_tokens = Math.min(Math.floor(asked), cap);

      const version = request.headers.get('anthropic-version') ?? '';
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': /^\d{4}-\d{2}-\d{2}$/.test(version) ? version : DEFAULT_VERSION,
      };
      const beta = request.headers.get('anthropic-beta');
      if (beta && /^[\w.,-]+$/.test(beta)) headers['anthropic-beta'] = beta;

      let res: Response;
      try {
        res = await upstream(ANTHROPIC_MESSAGES, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        return error(502, 'api_error', 'The relay could not reach Anthropic.', cors);
      }
      const out = corsHeaders(origin);
      out.set('content-type', res.headers.get('content-type') ?? 'application/json');
      for (const name of PASSED_HEADERS) {
        const v = res.headers.get(name);
        if (v !== null) out.set(name, v);
      }
      return new Response(res.body, { status: res.status, headers: out });
    },
  };
}
