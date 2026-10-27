/**
 * The Claude chat layer: rewrites a bot's scripted line in its own voice while
 * keeping the line's speech act. It never throws and never blocks the game; any
 * problem (no key, bad key, rate limit, timeout, budget, guardrail) returns the
 * scripted text with a reason.
 */
import type { PlayerView } from '../../engine/types.ts';
import type { BotSpeech } from '../types.ts';
import {
  DEFAULT_MODEL,
  callClaude,
  redact,
  relayEndpoint,
  type CallErrorKind,
  type CallOutcome,
  type FetchLike,
  type Usage,
} from './client.ts';
import { checkReply, cleanReply, type GuardRule } from './guard.ts';
import { buildPrompt, type Prompt } from './prompt.ts';

export type ChatState =
  | 'off'
  | 'ok'
  | 'invalid-key'
  | 'browser-blocked' // a working key whose organization refuses browser requests
  | 'relay-error' // the relay is unreachable, rejects the passphrase or this site, or lacks its secrets
  | 'rate-limited'
  | 'degraded';

export interface ChatStatus {
  state: ChatState;
  /** One plain sentence for the settings screen. Never contains the key. */
  detail: string;
  /** For `rate-limited`: when calls resume (ms since epoch, by the layer's clock). */
  retryAt: number | null;
  model: string;
}

export type FallbackReason =
  | 'off' // no key, or turned off
  | 'invalid-key'
  | 'browser-blocked' // the key's organization refuses browser requests
  | 'relay-error' // the relay refused the request (passphrase, site, setup)
  | 'unavailable' // spend limit, missing model, or cooling down after repeated failures
  | 'rate-limited'
  | 'budget' // per-game call budget used up
  | 'skipped' // low-value line skipped to save budget
  | 'busy' // too many calls in flight or this minute
  | 'timeout'
  | 'network'
  | 'server'
  | 'bad-request'
  | 'aborted'
  | 'refusal'
  | 'guardrail';

export interface RewriteResult {
  /** The text to send: Claude's line, or the scripted draft. */
  text: string;
  source: 'claude' | 'scripted';
  reason?: FallbackReason;
  /** Which guardrail rejected Claude's line. */
  rule?: GuardRule;
  /** Claude's raw reply, when there was one (for transcripts and tuning). */
  raw?: string;
  latencyMs?: number;
  usage?: Usage;
}

/** `key`: the browser calls Anthropic with the host's key. `relay`: the host's relay holds the key. */
export type ChatMode = 'key' | 'relay';

export interface ChatSettings {
  apiKey: string | null;
  model: string;
  /** Only for keys that are not scoped to one workspace. */
  workspaceId: string | null;
  enabled: boolean;
  mode: ChatMode;
  relayUrl: string | null;
  relayPassphrase: string | null;
}

export interface ChatLimits {
  /** Give up on a line after this long (queueing included) and use the script. */
  timeoutMs: number;
  maxCallsPerGame: number;
  maxConcurrent: number;
  maxCallsPerMinute: number;
  maxChars: number;
  maxTokens: number;
}

export const DEFAULT_LIMITS: ChatLimits = {
  timeoutMs: 4000,
  maxCallsPerGame: 300,
  maxConcurrent: 3,
  maxCallsPerMinute: 45,
  maxChars: 160,
  maxTokens: 120,
};

export interface ChatLayerOptions extends Partial<ChatSettings>, Partial<ChatLimits> {
  fetch?: FetchLike;
  clock?: () => number;
  url?: string;
}

export interface ChatMetrics {
  /** Lines offered to the layer. */
  lines: number;
  /** Lines sent with Claude's text. */
  claude: number;
  /** HTTP requests made. */
  calls: number;
  fallbacks: Partial<Record<FallbackReason, number>>;
  guardrail: Partial<Record<GuardRule, number>>;
  errors: Partial<Record<CallErrorKind, number>>;
  /** Latency of each successful request, ms. */
  latencyMs: number[];
  usage: Usage;
  /** Estimated spend in USD, or null for a model without a known price. */
  costUsd: number | null;
}

/** USD per million tokens. */
export const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function estimateCost(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadTokens * p.cacheRead +
      u.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

/** Lines that are skipped first when the budget or rate runs low. */
const LOW_PRIORITY = new Set([
  'greet',
  'banter',
  'mafiaBanter',
  'deadBanter',
  'trialReact',
  'quietNight',
]);

const FAILURES_FOR_DEGRADED = 3;
const FAILURES_FOR_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function emptyMetrics(): ChatMetrics {
  return {
    lines: 0,
    claude: 0,
    calls: 0,
    fallbacks: {},
    guardrail: {},
    errors: {},
    latencyMs: [],
    usage: emptyUsage(),
    costUsd: 0,
  };
}

function bump<K extends string>(rec: Partial<Record<K, number>>, k: K): void {
  rec[k] = (rec[k] ?? 0) + 1;
}

export class ChatLayer {
  readonly limits: ChatLimits;
  #key: string | null;
  #mode: ChatMode;
  #relayUrl: string | null;
  #relayPass: string | null;
  #model: string;
  #workspace: string | null;
  #enabled: boolean;
  #fetch: FetchLike;
  #clock: () => number;
  #url: string | undefined;
  /** Set until the host reconfigures: a bad key, a missing model, a spend limit. */
  #blocked: {
    state: 'invalid-key' | 'browser-blocked' | 'relay-error' | 'degraded';
    detail: string;
  } | null = null;
  #retryAt = 0;
  #failures = 0;
  #cooldownUntil = 0;
  #disableThinking = true;
  #lowEffort = true;
  #gameCalls = 0;
  #window: number[] = [];
  #inFlight = 0;
  #waiters: (() => void)[] = [];
  #listeners = new Set<(s: ChatStatus) => void>();
  #lastStatus = '';
  #metrics = emptyMetrics();

  constructor(opts: ChatLayerOptions = {}) {
    this.limits = {
      timeoutMs: opts.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
      maxCallsPerGame: opts.maxCallsPerGame ?? DEFAULT_LIMITS.maxCallsPerGame,
      maxConcurrent: opts.maxConcurrent ?? DEFAULT_LIMITS.maxConcurrent,
      maxCallsPerMinute: opts.maxCallsPerMinute ?? DEFAULT_LIMITS.maxCallsPerMinute,
      maxChars: opts.maxChars ?? DEFAULT_LIMITS.maxChars,
      maxTokens: opts.maxTokens ?? DEFAULT_LIMITS.maxTokens,
    };
    this.#key = normalizeKey(opts.apiKey);
    this.#mode = opts.mode === 'relay' ? 'relay' : 'key';
    this.#relayUrl = normalizeKey(opts.relayUrl);
    this.#relayPass = normalizeKey(opts.relayPassphrase);
    this.#model = opts.model?.trim() || DEFAULT_MODEL;
    this.#workspace = opts.workspaceId?.trim() || null;
    this.#enabled = opts.enabled ?? true;
    this.#fetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.#clock = opts.clock ?? Date.now;
    this.#url = opts.url;
    this.#resetModelParams();
    this.#lastStatus = JSON.stringify(this.status());
  }

  /** Change the key, relay, model, workspace, or on/off switch. Clears any earlier key error. */
  configure(patch: Partial<ChatSettings>): void {
    if (patch.apiKey !== undefined) this.#key = normalizeKey(patch.apiKey);
    if (patch.mode !== undefined) this.#mode = patch.mode === 'relay' ? 'relay' : 'key';
    if (patch.relayUrl !== undefined) this.#relayUrl = normalizeKey(patch.relayUrl);
    if (patch.relayPassphrase !== undefined) this.#relayPass = normalizeKey(patch.relayPassphrase);
    if (patch.model !== undefined) this.#model = patch.model.trim() || DEFAULT_MODEL;
    if (patch.workspaceId !== undefined) this.#workspace = patch.workspaceId?.trim() || null;
    if (patch.enabled !== undefined) this.#enabled = patch.enabled;
    this.#blocked = null;
    this.#retryAt = 0;
    this.#failures = 0;
    this.#cooldownUntil = 0;
    this.#resetModelParams();
    this.#emit();
  }

  /** Current settings without the key or passphrase. */
  get settings(): {
    hasKey: boolean;
    model: string;
    workspaceId: string | null;
    enabled: boolean;
    mode: ChatMode;
    relayUrl: string | null;
    hasRelay: boolean;
    /** The current mode has what it needs to call Claude (a key, or a relay URL and passphrase). */
    ready: boolean;
  } {
    const hasRelay = !!this.#relayUrl && !!this.#relayPass;
    return {
      hasKey: !!this.#key,
      model: this.#model,
      workspaceId: this.#workspace,
      enabled: this.#enabled,
      mode: this.#mode,
      relayUrl: this.#relayUrl,
      hasRelay,
      ready: this.#mode === 'relay' ? hasRelay : !!this.#key,
    };
  }

  #ready(): boolean {
    return this.#mode === 'relay' ? !!this.#relayUrl && !!this.#relayPass : !!this.#key;
  }

  status(): ChatStatus {
    const now = this.#clock();
    const s = (state: ChatState, detail: string, retryAt: number | null = null): ChatStatus => ({
      state,
      detail,
      retryAt,
      model: this.#model,
    });
    if (!this.#ready())
      return s(
        'off',
        this.#mode === 'relay'
          ? 'No relay set up. Bots use scripted chat.'
          : 'No Anthropic API key. Bots use scripted chat.',
      );
    if (!this.#enabled) return s('off', 'Claude chat is turned off. Bots use scripted chat.');
    if (this.#mode === 'relay' && !relayEndpoint(this.#relayUrl ?? ''))
      return s(
        'relay-error',
        'That relay URL is not valid. Paste the https:// address of your relay Worker.',
      );
    if (this.#blocked) return s(this.#blocked.state, this.#blocked.detail);
    if (now < this.#retryAt)
      return s(
        'rate-limited',
        'Anthropic asked us to slow down. Bots use scripted chat for a moment.',
        this.#retryAt,
      );
    if (this.#failures >= FAILURES_FOR_DEGRADED || now < this.#cooldownUntil)
      return s(
        'degraded',
        this.#mode === 'relay'
          ? 'The relay is not answering reliably. Bots use scripted chat for now.'
          : 'Claude is not answering reliably. Bots use scripted chat for now.',
      );
    if (this.#gameCalls >= this.limits.maxCallsPerGame)
      return s('degraded', "This game's Claude budget is used up. Bots use scripted chat.");
    return s('ok', 'Bots chat with Claude.');
  }

  /** Listen for status changes. Returns an unsubscribe function. */
  subscribe(fn: (s: ChatStatus) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Start a new game: resets the per-game call budget. */
  newGame(): void {
    this.#gameCalls = 0;
    this.#emit();
  }

  get callsThisGame(): number {
    return this.#gameCalls;
  }

  metrics(): ChatMetrics {
    const m = this.#metrics;
    return {
      ...m,
      fallbacks: { ...m.fallbacks },
      guardrail: { ...m.guardrail },
      errors: { ...m.errors },
      latencyMs: m.latencyMs.slice(),
      usage: { ...m.usage },
      costUsd: estimateCost(this.#model, m.usage),
    };
  }

  resetMetrics(): void {
    this.#metrics = emptyMetrics();
  }

  /**
   * Test the key with a tiny request (for a "Test key" button). Does not count
   * against the game budget. Resolves with the new status.
   */
  async check(signal?: AbortSignal): Promise<ChatStatus> {
    if (!this.#ready() || !this.#enabled) return this.status();
    this.#blocked = null;
    this.#retryAt = 0;
    const ping = { system: 'Reply with the single word: ready', user: 'Are you there?' };
    const opts = { maxTokens: 8, budget: false };
    let out = await this.#call(ping, this.limits.timeoutMs * 2, signal, opts);
    if (!out.ok && out.error.kind === 'bad-param') {
      this.#dropParam(out.error.param);
      out = await this.#call(ping, this.limits.timeoutMs * 2, signal, opts);
    }
    if (
      !out.ok &&
      this.#mode === 'relay' &&
      (out.error.kind === 'network' || out.error.kind === 'timeout')
    ) {
      // A browser can't tell a wrong address from a relay without CORS headers.
      this.#blocked = {
        state: 'relay-error',
        detail: `Could not reach the relay at ${hostOf(this.#relayUrl)}. Check the URL and that the Worker is deployed.`,
      };
    }
    this.#emit();
    return this.status();
  }

  /** Rewrite one bot line. Always resolves; on any problem `text` is the scripted draft. */
  async rewrite(
    view: PlayerView,
    speech: BotSpeech,
    opts: { signal?: AbortSignal } = {},
  ): Promise<RewriteResult> {
    const scripted = speech.intent.text;
    this.#metrics.lines++;
    const fallback = (
      reason: FallbackReason,
      extra: Partial<RewriteResult> = {},
    ): RewriteResult => {
      bump(this.#metrics.fallbacks, reason);
      this.#emit();
      return { text: scripted, source: 'scripted', reason, ...extra };
    };
    const start = this.#clock();
    const early = this.#gate(speech.category);
    if (early) return fallback(early);

    const deadline = start + this.limits.timeoutMs;
    if (!(await this.#acquire(deadline, opts.signal)))
      return fallback(opts.signal?.aborted ? 'aborted' : 'busy');
    try {
      // Other lines may have spent the budget, hit a limit, or failed while this
      // one waited. Nothing awaits between this check and the count in #call.
      const late = this.#gate(speech.category);
      if (late) return fallback(late);
      const prompt = buildPrompt(view, speech, this.limits.maxChars);
      let out = await this.#call(prompt, deadline - this.#clock(), opts.signal);
      if (!out.ok && out.error.kind === 'bad-param') {
        this.#dropParam(out.error.param);
        if (deadline - this.#clock() > 300 && !this.#gate(speech.category))
          out = await this.#call(prompt, deadline - this.#clock(), opts.signal);
      }
      if (!out.ok) return fallback(reasonFor(out.error.kind));
      if (out.stopReason === 'refusal') return fallback('refusal', { raw: out.text });
      const ctx = { view, speech, maxChars: this.limits.maxChars };
      const text = cleanReply(out.text, ctx);
      const rule = checkReply(text, ctx);
      if (rule) {
        bump(this.#metrics.guardrail, rule);
        return fallback('guardrail', { rule, raw: out.text, latencyMs: out.ms, usage: out.usage });
      }
      this.#metrics.claude++;
      this.#emit();
      return { text, source: 'claude', raw: out.text, latencyMs: out.ms, usage: out.usage };
    } finally {
      this.#release();
    }
  }

  /**
   * The same as `rewrite`, shaped for a host hook: resolves with Claude's text,
   * or null when the scripted line should be used.
   */
  async rewriteText(input: {
    view: PlayerView;
    speech: BotSpeech;
    signal?: AbortSignal;
  }): Promise<string | null> {
    const r = await this.rewrite(input.view, input.speech, { signal: input.signal });
    return r.source === 'claude' ? r.text : null;
  }

  async #call(
    prompt: Prompt,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    opts: { maxTokens?: number; budget?: boolean } = {},
  ): Promise<CallOutcome> {
    const credential =
      this.#mode === 'relay'
        ? this.#relayUrl && this.#relayPass
          ? { url: this.#relayUrl, passphrase: this.#relayPass }
          : null
        : this.#key;
    if (!credential) return { ok: false, error: { kind: 'aborted', message: 'no key' }, ms: 0 };
    const secret = typeof credential === 'string' ? credential : credential.passphrase;
    if (timeoutMs < 300)
      return { ok: false, error: { kind: 'timeout', message: 'no time left' }, ms: 0 };
    if (opts.budget !== false) {
      this.#gameCalls++;
      this.#window.push(this.#clock());
    }
    this.#metrics.calls++;
    const out = await callClaude(
      this.#fetch,
      credential,
      {
        model: this.#model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: opts.maxTokens ?? this.limits.maxTokens,
        disableThinking: this.#disableThinking,
        lowEffort: this.#lowEffort,
      },
      { timeoutMs, workspaceId: this.#workspace, signal, url: this.#url, clock: this.#clock },
    );
    if (out.ok) {
      const u = this.#metrics.usage;
      u.inputTokens += out.usage.inputTokens;
      u.outputTokens += out.usage.outputTokens;
      u.cacheReadTokens += out.usage.cacheReadTokens;
      u.cacheWriteTokens += out.usage.cacheWriteTokens;
      this.#metrics.latencyMs.push(out.ms);
      this.#failures = 0;
      this.#cooldownUntil = 0;
      return out;
    }
    const e = out.error;
    bump(this.#metrics.errors, e.kind);
    const relay = this.#mode === 'relay';
    switch (e.kind) {
      case 'invalid-key':
        this.#blocked = {
          state: 'invalid-key',
          detail: relay
            ? "Anthropic rejected the relay's API key. Update the relay's ANTHROPIC_API_KEY secret."
            : e.status === 403
              ? 'This API key is not allowed to use Claude. Bots use scripted chat.'
              : 'Anthropic rejected this API key. Bots use scripted chat.',
        };
        break;
      case 'relay-auth':
        this.#blocked = {
          state: 'relay-error',
          detail: 'The relay rejected the passphrase. Check it and try again.',
        };
        break;
      case 'relay-origin':
        this.#blocked = {
          state: 'relay-error',
          detail:
            "The relay does not accept requests from this site. Add this site's address to the relay's ALLOWED_ORIGINS.",
        };
        break;
      case 'relay-config':
        this.#blocked = {
          state: 'relay-error',
          detail: relayEndpoint(this.#relayUrl ?? '')
            ? 'The relay is missing its ANTHROPIC_API_KEY or RELAY_PASSPHRASE secret.'
            : 'That relay URL is not valid. Paste the https:// address of your relay Worker.',
        };
        break;
      case 'browser-blocked':
        this.#blocked = {
          state: 'browser-blocked',
          detail:
            "This key's Anthropic organization blocks browser requests (custom data retention). Use a key from an organization without custom retention.",
        };
        break;
      case 'workspace':
        this.#blocked = {
          state: 'invalid-key',
          detail:
            'This API key is not tied to one workspace. Use a workspace key or add a workspace ID.',
        };
        break;
      case 'spend-limit':
        this.#blocked = {
          state: 'degraded',
          detail: 'The Anthropic account has reached its spending limit. Bots use scripted chat.',
        };
        break;
      case 'model':
        this.#blocked = {
          state: 'degraded',
          detail: relay
            ? `The relay does not allow the model "${this.#model}". Pick a model it allows, or add it to the relay's ALLOWED_MODELS.`
            : `The model "${this.#model}" is not available to this key. Pick another model.`,
        };
        break;
      case 'rate-limited': {
        const wait = e.retryAfterMs ?? 20_000;
        this.#retryAt = this.#clock() + wait;
        const timer = setTimeout(() => this.#emit(), wait + 10) as unknown as {
          unref?: () => void;
        };
        timer.unref?.();
        break;
      }
      case 'bad-param':
      case 'aborted':
        break;
      default:
        this.#failures++;
        if (this.#failures >= FAILURES_FOR_COOLDOWN) {
          this.#cooldownUntil = this.#clock() + COOLDOWN_MS;
          this.#failures = FAILURES_FOR_DEGRADED;
        }
    }
    this.#emit();
    return { ...out, error: { ...e, message: redact(e.message, secret) } };
  }

  #resetModelParams(): void {
    // Haiku accepts disabled thinking at low effort; other models may not, and a
    // rejection drops the parameter for the rest of the session.
    this.#disableThinking = /haiku/i.test(this.#model);
    this.#lowEffort = true;
  }

  #dropParam(param: 'thinking' | 'effort' | undefined): void {
    if (param === 'thinking') this.#disableThinking = false;
    else this.#lowEffort = false;
  }

  /** Why a line must use its script right now, or null when Claude may be called. */
  #gate(category: string): FallbackReason | null {
    const now = this.#clock();
    if (!this.#ready() || !this.#enabled) return 'off';
    if (this.#blocked)
      return this.#blocked.state === 'degraded' ? 'unavailable' : this.#blocked.state;
    if (now < this.#retryAt) return 'rate-limited';
    if (now < this.#cooldownUntil) return 'unavailable';
    if (this.#gameCalls >= this.limits.maxCallsPerGame) return 'budget';
    this.#window = this.#window.filter((t) => t > now - 60_000);
    if (
      LOW_PRIORITY.has(category) &&
      (this.#gameCalls >= this.limits.maxCallsPerGame * 0.75 ||
        this.#window.length >= this.limits.maxCallsPerMinute * 0.7)
    )
      return 'skipped';
    if (this.#window.length >= this.limits.maxCallsPerMinute) return 'busy';
    return null;
  }

  #acquire(deadline: number, signal?: AbortSignal): Promise<boolean> {
    if (this.#inFlight < this.limits.maxConcurrent) {
      this.#inFlight++;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const i = this.#waiters.indexOf(waiter);
        if (i >= 0) this.#waiters.splice(i, 1);
        resolve(ok);
      };
      // A released slot is handed straight to the next waiter.
      const waiter = () => finish(true);
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), Math.max(0, deadline - this.#clock() - 300));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #release(): void {
    const next = this.#waiters.shift();
    if (next) next();
    else this.#inFlight--;
  }

  #emit(): void {
    const s = this.status();
    const json = JSON.stringify(s);
    if (json === this.#lastStatus) return;
    this.#lastStatus = json;
    for (const fn of this.#listeners) fn(s);
  }
}

function normalizeKey(key: string | null | undefined): string | null {
  const k = key?.trim();
  return k ? k : null;
}

function hostOf(url: string | null): string {
  try {
    return new URL(url ?? '').host;
  } catch {
    return 'that address';
  }
}

function reasonFor(kind: CallErrorKind): FallbackReason {
  switch (kind) {
    case 'invalid-key':
    case 'workspace':
      return 'invalid-key';
    case 'browser-blocked':
      return 'browser-blocked';
    case 'relay-auth':
    case 'relay-origin':
    case 'relay-config':
      return 'relay-error';
    case 'spend-limit':
    case 'model':
      return 'unavailable';
    case 'rate-limited':
      return 'rate-limited';
    case 'timeout':
      return 'timeout';
    case 'network':
      return 'network';
    case 'server':
      return 'server';
    case 'aborted':
      return 'aborted';
    case 'bad-param':
    case 'bad-request':
      return 'bad-request';
  }
}

/** Rewrite a bot's line and return a ready-to-apply copy of the speech. */
export async function voiceSpeech(
  layer: ChatLayer,
  view: PlayerView,
  speech: BotSpeech,
  opts: { signal?: AbortSignal } = {},
): Promise<{ speech: BotSpeech; result: RewriteResult }> {
  const result = await layer.rewrite(view, speech, opts);
  return { speech: { ...speech, intent: { ...speech.intent, text: result.text } }, result };
}
