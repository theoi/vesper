/**
 * Minimal Anthropic Messages API client for the browser (and Node 24, which has
 * fetch). The caller supplies the key; it is sent only to Anthropic, in a
 * request header, and never appears in returned errors. In relay mode the
 * request goes to the host's own relay (`relay/` in this repo) with a
 * passphrase instead, and the relay adds the key on the server.
 */

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';
/** Fastest current model; the host can pick another in settings. */
export const DEFAULT_MODEL = 'claude-haiku-5-5';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The host's relay: it holds the Anthropic key and checks this passphrase. */
export interface RelayTarget {
  url: string;
  passphrase: string;
}

export const RELAY_PASSPHRASE_HEADER = 'x-relay-passphrase';

/**
 * The relay's Messages endpoint for the URL the host pasted (with or without
 * `/v1/messages`), or null if it isn't a usable URL. Plain http is allowed
 * only for a relay on this computer.
 */
export function relayEndpoint(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password) return null;
  u.search = '';
  u.hash = '';
  u.pathname = `${u.pathname.replace(/\/+$/, '').replace(/\/v1\/messages$/, '')}/v1/messages`;
  return u.toString();
}

export function relayHeaders(passphrase: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    [RELAY_PASSPHRASE_HEADER]: passphrase,
  };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CallRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Send `thinking: {type: 'disabled'}` (dropped automatically if a model rejects it). */
  disableThinking: boolean;
  /** Send `output_config.effort: 'low'` (dropped automatically if a model rejects it). */
  lowEffort: boolean;
}

export type CallErrorKind =
  | 'invalid-key' // 401, or a key without permission
  | 'browser-blocked' // the key's organization refuses browser (CORS) requests
  | 'workspace' // key needs an anthropic-workspace-id header
  | 'rate-limited' // 429 with a retry time
  | 'spend-limit' // the account's spend or usage limit is reached
  | 'model' // the model does not exist or is not available to this key
  | 'bad-param' // the model rejected `thinking` or `output_config`
  | 'bad-request'
  | 'server' // 5xx and 529 overloaded
  | 'relay-auth' // the relay rejected the passphrase
  | 'relay-origin' // the relay does not accept requests from this site
  | 'relay-config' // the relay is missing its key or passphrase secret
  | 'network'
  | 'timeout'
  | 'aborted';

export interface CallError {
  kind: CallErrorKind;
  status?: number;
  /** When to try again, for `rate-limited`. */
  retryAfterMs?: number;
  /** Which parameter to drop, for `bad-param`. */
  param?: 'thinking' | 'effort';
  /** Short, key-free description for logs and the settings screen. */
  message: string;
}

export type CallOutcome =
  | { ok: true; text: string; stopReason: string | null; usage: Usage; ms: number }
  | { ok: false; error: CallError; ms: number };

export function requestHeaders(
  apiKey: string,
  workspaceId?: string | null,
): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (workspaceId) h['anthropic-workspace-id'] = workspaceId;
  return h;
}

export function requestBody(req: CallRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.user }],
  };
  if (req.lowEffort) body.output_config = { effort: 'low' };
  if (req.disableThinking) body.thinking = { type: 'disabled' };
  return body;
}

/** Replace every occurrence of `secret` in `text`. */
export function redact(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('[redacted]');
}

function retryAfter(res: Response, now: number): number {
  const s = Number(res.headers.get('retry-after'));
  if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, 300_000);
  for (const h of ['anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset']) {
    const at = Date.parse(res.headers.get(h) ?? '');
    if (Number.isFinite(at) && at > now) return Math.min(at - now, 300_000);
  }
  return 20_000;
}

interface ApiErrorBody {
  error?: { type?: string; message?: string; details?: { error_code?: string } };
}

/** Organizations with custom data retention reject browser requests with a 401 that says so. */
const BROWSER_BLOCKED = /\bCORS requests are not allowed\b|\bcustom (?:data )?retention\b/i;

function classify(res: Response, body: ApiErrorBody, now: number): CallError {
  const status = res.status;
  const type = body.error?.type ?? '';
  const raw = body.error?.message ?? '';
  const message = `${status} ${type}${raw ? `: ${raw.slice(0, 160)}` : ''}`.trim();
  // Errors the Vesper relay adds on top of Anthropic's own.
  if (type === 'relay_auth') return { kind: 'relay-auth', status, message };
  if (type === 'relay_origin') return { kind: 'relay-origin', status, message };
  if (type === 'relay_config') return { kind: 'relay-config', status, message };
  if (type === 'relay_model') return { kind: 'model', status, message };
  if (type === 'relay_too_large') return { kind: 'bad-request', status, message };
  if (status >= 400 && status < 500 && status !== 429 && BROWSER_BLOCKED.test(raw))
    return { kind: 'browser-blocked', status, message };
  if (status === 401) return { kind: 'invalid-key', status, message };
  if (status === 403) return { kind: 'invalid-key', status, message };
  if (status === 429) {
    if (body.error?.details?.error_code === 'enforced_spend_limit_reached')
      return { kind: 'spend-limit', status, message };
    return { kind: 'rate-limited', status, message, retryAfterMs: retryAfter(res, now) };
  }
  if (status === 404) return { kind: 'model', status, message };
  if (status === 400 || status === 413 || status === 422) {
    if (/workspace/i.test(raw)) return { kind: 'workspace', status, message };
    if (/usage limit|spend limit|credit balance/i.test(raw))
      return { kind: 'spend-limit', status, message };
    if (/thinking/i.test(raw)) return { kind: 'bad-param', param: 'thinking', status, message };
    if (/effort|output_config/i.test(raw))
      return { kind: 'bad-param', param: 'effort', status, message };
    if (/\bmodel\b/i.test(raw)) return { kind: 'model', status, message };
    return { kind: 'bad-request', status, message };
  }
  return { kind: 'server', status, message };
}

/** Send one Messages request, to Anthropic with a key or to a relay. Never throws. */
export async function callClaude(
  fetchFn: FetchLike,
  credential: string | RelayTarget,
  req: CallRequest,
  opts: {
    timeoutMs: number;
    workspaceId?: string | null;
    signal?: AbortSignal;
    url?: string;
    clock?: () => number;
  },
): Promise<CallOutcome> {
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      ctrl.abort();
    },
    Math.max(1, opts.timeoutMs),
  );
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const relay = typeof credential === 'string' ? null : credential;
  const secret = relay ? relay.passphrase : (credential as string);
  const fail = (error: CallError): CallOutcome => ({
    ok: false,
    error: { ...error, message: redact(error.message, secret) },
    ms: clock() - t0,
  });
  try {
    if (opts.signal?.aborted) return fail({ kind: 'aborted', message: 'aborted' });
    const url = relay ? relayEndpoint(relay.url) : (opts.url ?? ANTHROPIC_URL);
    if (!url) return fail({ kind: 'relay-config', message: 'not a usable relay URL' });
    const res = await fetchFn(url, {
      method: 'POST',
      headers: relay ? relayHeaders(relay.passphrase) : requestHeaders(secret, opts.workspaceId),
      body: JSON.stringify(requestBody(req)),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return fail(classify(res, json as ApiErrorBody, clock()));
    const content = Array.isArray(json.content) ? (json.content as Record<string, unknown>[]) : [];
    const text = content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    const u = (json.usage ?? {}) as Record<string, number | undefined>;
    return {
      ok: true,
      text,
      stopReason: typeof json.stop_reason === 'string' ? json.stop_reason : null,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
      ms: clock() - t0,
    };
  } catch (err) {
    if (timedOut) return fail({ kind: 'timeout', message: `no reply within ${opts.timeoutMs} ms` });
    if (opts.signal?.aborted) return fail({ kind: 'aborted', message: 'aborted' });
    const msg = err instanceof Error ? err.message : String(err);
    return fail({ kind: 'network', message: msg.slice(0, 160) });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
