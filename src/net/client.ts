import type { Intent } from '../engine/index.ts';
import { playerToken } from './identity.ts';
import {
  PROTOCOL_VERSION,
  parseHostMessage,
  type ClientMessage,
  type HostMessage,
} from './protocol.ts';
import { Store, mergeView, type GameSession, type SessionSnapshot } from './session.ts';
import { backgroundTimers, type TimerApi } from './timers.ts';
import { NetError, toNetError, type ClientTransport, type Transport } from './transport.ts';

export interface ClientOptions {
  code: string;
  name: string;
  transport: Transport;
  /** Defaults to a per-room token derived from this browser's stable token. */
  token?: string;
  /** Called with every message received from the host (tests and debugging). */
  onReceive?: (msg: HostMessage) => void;
  /** Timer source for heartbeats. Defaults to worker timers that keep running in hidden tabs. */
  timers?: TimerApi;
}

/**
 * Long enough for the default transport to try both halves: PeerJS can take
 * 12 s to give up on signaling (or 15 s on ICE), then Trystero waits 8 s for
 * the host. A shorter limit would cut off the Trystero fallback.
 */
const CONNECT_TIMEOUT_MS = 35_000;
const WELCOME_TIMEOUT_MS = 10_000;
const PING_MS = 4000;
const HOST_SILENCE_MS = 12_000;
const RECONNECT_WINDOW_MS = 30_000;

const HOST_LEFT = 'The host left, so the game has ended.';
const LOST = 'Lost the connection to the host. If the host closed the page, the game has ended.';

/** Per-room seat token, so a host never learns the token this browser uses elsewhere. */
export async function roomToken(code: string, base: string = playerToken()): Promise<string> {
  const data = new TextEncoder().encode(`${base}:${code}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new NetError('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A remote player's connection to a host. */
export class ClientSession implements GameSession {
  readonly isHost = false;
  private readonly store: Store;
  private readonly opts: ClientOptions;
  private transport: ClientTransport | null = null;
  private terminal = false;
  private joined = false;
  private lastHeard = 0;
  private pinger: number | null = null;
  private readonly timers: TimerApi;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private name: string;

  constructor(opts: ClientOptions) {
    this.opts = opts;
    this.name = opts.name;
    this.timers = opts.timers ?? backgroundTimers();
    this.store = new Store({
      isHost: false,
      status: 'connecting',
      code: opts.code,
      you: null,
      lobby: null,
      view: null,
      clockOffset: 0,
      network: { state: 'open' },
      notice: null,
      lastRejection: null,
    });
  }

  snapshot(): SessionSnapshot {
    return this.store.get();
  }

  subscribe(listener: (s: SessionSnapshot) => void): () => void {
    return this.store.subscribe(listener);
  }

  /** Connect and claim a seat. Resolves once the hello is sent; watch `status` for the result. */
  async join(): Promise<void> {
    try {
      await this.connectOnce();
    } catch (e) {
      const err = toNetError(e);
      this.fail('error', err.code, err.message);
    }
  }

  sendIntent(intent: Intent): number {
    const id = this.nextId++;
    this.send({ t: 'intent', id, intent });
    return id;
  }

  rename(name: string): void {
    this.name = name;
    this.send({ t: 'rename', name });
  }

  leave(): void {
    if (this.terminal) return;
    this.send({ t: 'bye' });
    const t = this.transport;
    setTimeout(() => t?.close(), 100);
    this.fail('closed', 'left', 'You left the room.', false);
  }

  private send(msg: ClientMessage): void {
    if (!this.terminal) this.transport?.send(msg);
  }

  private async connectOnce(): Promise<void> {
    const t = this.opts.transport.client(this.opts.code);
    this.transport = t;
    t.onMessage = (raw) => {
      if (this.transport === t) this.receive(raw);
    };
    t.onClose = () => {
      if (this.transport === t) this.lost();
    };
    try {
      await withTimeout(t.connect(), CONNECT_TIMEOUT_MS);
    } catch (e) {
      if (this.transport === t) this.transport = null;
      t.close();
      throw toNetError(e, 'timeout');
    }
    if (this.terminal) {
      t.close();
      return;
    }
    const token = this.opts.token ?? (await roomToken(this.opts.code));
    this.lastHeard = Date.now();
    t.send({ t: 'hello', v: PROTOCOL_VERSION, token, name: this.name });
    this.welcomeTimer = setTimeout(() => {
      if (this.transport !== t) return;
      t.close();
      this.transport = null;
      if (this.joined) this.lost();
      else this.fail('error', 'timeout', new NetError('timeout').message);
    }, WELCOME_TIMEOUT_MS);
    this.startPing();
  }

  private receive(raw: unknown): void {
    const msg = parseHostMessage(raw);
    if (!msg || this.terminal) return;
    this.lastHeard = Date.now();
    this.opts.onReceive?.(msg);
    switch (msg.t) {
      case 'welcome':
        if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
        this.joined = true;
        this.store.set({ you: msg.you, notice: null });
        return;
      case 'reject':
        this.fail('error', msg.reason, msg.message);
        return;
      case 'lobby': {
        const status =
          msg.lobby.status === 'open'
            ? 'lobby'
            : msg.lobby.status === 'playing'
              ? 'playing'
              : 'ended';
        const view = msg.lobby.status === 'open' ? null : this.store.get().view;
        this.store.set({ lobby: msg.lobby, status, view });
        return;
      }
      case 'view':
        this.store.set({
          view: mergeView(this.store.get().view, msg),
          clockOffset: msg.hostNow - Date.now(),
        });
        return;
      case 'rejected':
        this.store.set({ lastRejection: { id: msg.id, error: msg.error } });
        return;
      case 'pong': {
        const now = Date.now();
        this.store.set({ clockOffset: msg.hostNow + (now - msg.at) / 2 - now });
        return;
      }
      case 'closed':
        this.fail('closed', msg.reason, msg.message);
        return;
    }
  }

  private startPing(): void {
    this.stopPing();
    // Worker timers: a throttled hidden tab would otherwise go quiet long enough
    // for the host to drop it.
    this.pinger = this.timers.setTimeout(() => {
      this.pinger = null;
      if (this.terminal) return;
      if (Date.now() - this.lastHeard > HOST_SILENCE_MS) {
        const t = this.transport;
        this.transport = null;
        t?.close();
        this.lost();
        return;
      }
      this.send({ t: 'ping', at: Date.now() });
      this.startPing();
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pinger !== null) this.timers.clearTimeout(this.pinger);
    this.pinger = null;
  }

  private lost(): void {
    if (this.terminal) return;
    this.stopPing();
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    this.transport = null;
    if (!this.joined) {
      this.fail('error', 'connectFailed', new NetError('connectFailed').message);
      return;
    }
    this.store.set({ status: 'reconnecting' });
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    const deadline = Date.now() + RECONNECT_WINDOW_MS;
    let delay = 500;
    let roomGone = false;
    while (!this.terminal && Date.now() < deadline) {
      try {
        await this.connectOnce();
        return;
      } catch (e) {
        // A missing room may be the host's page reloading: it reopens the same
        // code, so keep trying until the window closes. Once the room has been
        // missing, a later network error doesn't change what happened.
        if (toNetError(e).code === 'roomNotFound') roomGone = true;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 4000);
    }
    if (this.terminal) return;
    if (roomGone) this.fail('closed', 'hostLeft', HOST_LEFT);
    else this.fail('closed', 'lost', LOST);
  }

  private fail(status: 'closed' | 'error', code: string, message: string, close = true): void {
    if (this.terminal) return;
    this.terminal = true;
    this.stopPing();
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    if (close) {
      const t = this.transport;
      this.transport = null;
      t?.close();
    }
    this.store.set({ status, notice: { code, message } });
  }
}
