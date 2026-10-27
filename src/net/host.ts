import { createBot, decideBot, pickBotNames } from '../bots/index.ts';
import type { BotSpeech, BotState } from '../bots/index.ts';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyIntent,
  createGame,
  eventsFor,
  nextDeadline,
  tick,
  validateRoleList,
  viewFor,
  type GameState,
  type Intent,
  type PlayerId,
  type PhaseKind,
  type PlayerView,
  type StepResult,
} from '../engine/index.ts';
import { randomId } from './identity.ts';
import {
  gameConfigFor,
  lobbyView,
  uniqueName,
  type LobbySeat,
  type LobbySettings,
  type LobbyStatus,
  type LobbyView,
} from './lobby.ts';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type CloseReason,
  type HostMessage,
  type RejectReason,
} from './protocol.ts';
import { randomCode } from './room.ts';
import { backgroundTimers, type TimerApi } from './timers.ts';
import {
  Store,
  ViewChannel,
  mergeView,
  type GameSession,
  type NetworkState,
  type SessionSnapshot,
} from './session.ts';
import { NetError, toNetError, type HostTransport, type Transport } from './transport.ts';

/** The outcome of rewriting one bot line. */
export interface SpeechRewrite {
  text: string;
  source: 'claude' | 'scripted';
  /** Why the scripted line was kept (e.g. 'off', 'timeout', 'budget'). */
  reason?: string;
}

/**
 * Optional rewrite of a bot's chat line (the Claude layer). Resolve with the
 * new text (or a SpeechRewrite), or null to keep the scripted line.
 * Rejections and timeouts fall back to the scripted line.
 */
export type SpeechRewriter = (input: {
  bot: BotState;
  view: PlayerView;
  speech: BotSpeech;
}) => Promise<SpeechRewrite | string | null>;

/** One bot chat line as the host handled it. Host-only transcript; never sent to clients. */
export interface BotLine {
  at: number;
  day: number;
  phase: PhaseKind;
  bot: PlayerId;
  name: string;
  channel: string;
  /** The template category the scripted line came from. */
  category: string;
  scripted: string;
  text: string;
  source: 'claude' | 'scripted';
  reason?: string;
  /** False if the engine rejected the line (e.g. the phase changed while Claude was writing). */
  delivered: boolean;
}

export interface HostOptions {
  hostName: string;
  /** Null plays offline (solo with bots); no one else can join. */
  transport: Transport | null;
  code?: string;
  rewriteSpeech?: SpeechRewriter;
  /** Return false to skip the rewriter and apply scripted lines at once (e.g. no key). */
  shouldRewrite?: () => boolean;
  /** Timer source for the game loop. Defaults to worker timers that keep running in hidden tabs. */
  timers?: TimerApi;
  /** Called when a game starts (e.g. to reset a per-game Claude budget). */
  onGameStart?: () => void;
  /** Called for every message sent to a client (tests and debugging). */
  onSend?: (playerId: PlayerId, msg: HostMessage) => void;
}

/** Delay before bots react to new events, so they don't answer instantly. */
const BOT_REACT_MS = 400;
const SPEECH_TIMEOUT_MS = 8000;
const MAX_TRANSCRIPT = 3000;
/** Drop a client that has sent nothing (not even a ping) for this long. */
const CLIENT_SILENCE_MS = 15_000;
const SWEEP_MS = 5000;
/** Intent rate limit per player: burst size and refill per second. */
const BUCKET_SIZE = 12;
const BUCKET_REFILL = 4;
const OPEN_ATTEMPTS = 3;

interface Peer {
  id: string;
  playerId: PlayerId;
  lastSeen: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

const HOST_LEFT = 'The host left, so the game has ended.';

const REJECT_MESSAGES: Record<RejectReason, string> = {
  full: 'This room is full.',
  started: 'This game has already started. Ask the host to let you in next game.',
  version: 'Your page is out of date. Reload to get the latest version.',
  kicked: 'The host removed you from this room.',
  badHello: 'Could not join this room.',
};

/**
 * The host's side of a room. Runs the engine and bots, and sends each player
 * only their own view. The host also plays: the UI uses this object as the
 * host's GameSession.
 */
export class HostSession implements GameSession {
  readonly isHost = true;
  readonly hostId: PlayerId;
  private _code: string;
  private readonly store: Store;
  private readonly opts: HostOptions;
  private transport: HostTransport | null = null;
  private seats: LobbySeat[];
  private settings: LobbySettings = { roles: null, pace: 'standard' };
  private status: LobbyStatus = 'open';
  private game: GameState | null = null;
  private bots = new Map<PlayerId, BotState>();
  private botsDirty = false;
  /** Bumped per game so late Claude replies from an old game are dropped. */
  private gameGen = 0;
  private speechChain = new Map<PlayerId, Promise<void>>();
  private transcript: BotLine[] = [];
  private channels = new Map<PlayerId, ViewChannel>();
  private tokens = new Map<string, PlayerId>();
  private banned = new Set<string>();
  private peers = new Map<string, Peer>();
  private peerOf = new Map<PlayerId, string>();
  private buckets = new Map<PlayerId, Bucket>();
  private readonly timers: TimerApi;
  private timer: number | null = null;
  private sweeper: number | null = null;
  private closed = false;

  constructor(opts: HostOptions) {
    this.opts = opts;
    this.timers = opts.timers ?? backgroundTimers();
    this._code = opts.code ?? randomCode();
    this.hostId = `p-${randomId(4)}`;
    this.seats = [
      {
        id: this.hostId,
        name: uniqueName(opts.hostName, [], 'Host'),
        kind: 'host',
        connected: true,
      },
    ];
    this.channels.set(this.hostId, new ViewChannel(this.hostId));
    this.store = new Store({
      isHost: true,
      status: 'lobby',
      code: this.code,
      you: this.hostId,
      lobby: this.lobby(),
      view: null,
      clockOffset: 0,
      network: { state: opts.transport ? 'opening' : 'offline' },
      notice: null,
      lastRejection: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Room lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Make the room reachable for friends. Resolves with the network state; a
   * failure leaves the room usable offline (solo with bots).
   */
  async open(): Promise<NetworkState> {
    const transport = this.opts.transport;
    if (!transport) return this.setNetwork({ state: 'offline' });
    this.setNetwork({ state: 'opening' });
    let lastError: NetError = new NetError('signaling');
    for (let attempt = 0; attempt < OPEN_ATTEMPTS && !this.closed; attempt++) {
      const t = transport.host(this._code);
      try {
        await t.open();
      } catch (e) {
        t.close();
        lastError = toNetError(e);
        if (lastError.code !== 'roomTaken') break;
        // Collisions are rare; a fresh code is safe because nobody has the link yet.
        this._code = randomCode();
        this.store.set({ code: this._code, lobby: this.lobby() });
        continue;
      }
      if (this.closed) {
        t.close();
        return this.setNetwork({ state: 'offline' });
      }
      this.attach(t);
      this.scheduleSweep();
      return this.setNetwork({ state: 'open' });
    }
    return this.setNetwork({ state: 'error', error: lastError });
  }

  /** Close the room. Every client is told the game has ended. */
  leave(): void {
    if (this.closed) return;
    this.closed = true;
    for (const peer of this.peers.values()) {
      this.sendTo(peer, { t: 'closed', reason: 'hostLeft', message: HOST_LEFT });
    }
    this.clearTimer();
    if (this.sweeper !== null) this.timers.clearTimeout(this.sweeper);
    // Give the goodbye messages a moment to flush before tearing down.
    const t = this.transport;
    this.transport = null;
    if (t) setTimeout(() => t.close(), 200);
    this.peers.clear();
    this.peerOf.clear();
    this.store.set({
      status: 'closed',
      notice: { code: 'hostLeft', message: 'You closed the room.' },
    });
  }

  get code(): string {
    return this._code;
  }

  snapshot(): SessionSnapshot {
    return this.store.get();
  }

  subscribe(listener: (s: SessionSnapshot) => void): () => void {
    return this.store.subscribe(listener);
  }

  /** Every bot chat line this game, with whether Claude wrote it. Host only. */
  botLines(): BotLine[] {
    return this.transcript.slice();
  }

  /** Host state for tests and debugging. Holds every secret; never send it anywhere. */
  debugState(): { game: GameState | null; tokens: Record<string, PlayerId> } {
    return { game: this.game, tokens: Object.fromEntries(this.tokens) };
  }

  // ---------------------------------------------------------------------------
  // Lobby controls (host only)
  // ---------------------------------------------------------------------------

  rename(name: string): void {
    this.renameSeat(this.hostId, name);
  }

  addBot(count = 1): void {
    if (this.status !== 'open') return;
    const room = MAX_PLAYERS - this.seats.length;
    const names = pickBotNames(
      Math.min(count, room),
      randomId(4),
      this.seats.map((s) => s.name),
    );
    for (const name of names) {
      this.seats.push({ id: `b-${randomId(4)}`, name, kind: 'bot', connected: true });
    }
    if (names.length > 0) this.lobbyChanged();
  }

  /** Add bots until the table has `total` seats. */
  fillWithBots(total: number): void {
    this.addBot(Math.max(0, Math.min(total, MAX_PLAYERS) - this.seats.length));
  }

  /** Remove a bot, or remove (and ban for this room) a human. */
  removeSeat(playerId: PlayerId): void {
    if (this.status !== 'open' || playerId === this.hostId) return;
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    if (seat.kind === 'human') {
      for (const [token, id] of this.tokens) if (id === playerId) this.banned.add(token);
      const peerId = this.peerOf.get(playerId);
      const peer = peerId ? this.peers.get(peerId) : undefined;
      if (peer) this.disconnectPeer(peer, 'kicked', 'The host removed you from this room.');
      for (const [token, id] of this.tokens) if (id === playerId) this.tokens.delete(token);
      this.channels.delete(playerId);
    }
    this.seats = this.seats.filter((s) => s.id !== playerId);
    this.lobbyChanged();
  }

  updateSettings(patch: Partial<LobbySettings>): void {
    if (this.status !== 'open') return;
    if (patch.pace === 'standard' || patch.pace === 'fast') this.settings.pace = patch.pace;
    if (patch.roles !== undefined) this.settings.roles = patch.roles ? patch.roles.slice() : null;
    this.lobbyChanged();
  }

  /** Start the game. Returns an error message instead if it can't start. */
  start(): string | null {
    if (this.status !== 'open') return 'The game is already running.';
    if (this.seats.length < MIN_PLAYERS)
      return `You need at least ${MIN_PLAYERS} seats. Add bots to fill the table.`;
    const config = gameConfigFor(this.seats, this.settings);
    const validation = validateRoleList(config.roles, config.players.length);
    if (!validation.ok) return validation.errors.join(' ');
    const seed = randomId(8);
    const now = Date.now();
    let result: StepResult;
    try {
      result = createGame(config, seed, now);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    this.game = result.state;
    this.gameGen++;
    this.speechChain.clear();
    this.transcript = [];
    this.opts.onGameStart?.();
    this.bots.clear();
    for (const seat of this.seats) {
      if (seat.kind === 'bot') this.bots.set(seat.id, createBot(seat.id, `${seed}:${seat.id}`));
    }
    this.botsDirty = true;
    for (const ch of this.channels.values()) ch.reset();
    this.status = 'playing';
    this.lobbyChanged();
    this.afterStep();
    return null;
  }

  /** After a game ends, return everyone to the lobby for another round. */
  backToLobby(): void {
    if (this.status !== 'ended') return;
    this.game = null;
    this.gameGen++;
    this.bots.clear();
    this.clearTimer();
    for (const ch of this.channels.values()) ch.reset();
    this.status = 'open';
    this.store.set({ view: null });
    this.lobbyChanged();
  }

  // ---------------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------------

  private nextIntentId = 1;

  sendIntent(intent: Intent): number {
    const id = this.nextIntentId++;
    const error = this.handleIntent(this.hostId, intent);
    if (error) this.store.set({ lastRejection: { id, error } });
    return id;
  }

  private handleIntent(playerId: PlayerId, intent: Intent): string | null {
    if (!this.game || this.closed) return 'The game has not started.';
    const now = Date.now();
    this.catchUp(now);
    const r = applyIntent(this.game, playerId, intent, now);
    if (r.error) return r.error;
    this.game = r.state;
    if (r.events.length > 0) this.botsDirty = true;
    this.afterStep();
    return null;
  }

  /** Advance expired phases. The engine never ticks on its own. */
  private catchUp(now: number): void {
    if (!this.game) return;
    const deadline = nextDeadline(this.game);
    if (deadline === null || now < deadline) return;
    const r = tick(this.game, now);
    this.game = r.state;
    if (r.events.length > 0) this.botsDirty = true;
  }

  private loop(): void {
    this.timer = null;
    if (!this.game || this.closed) return;
    const now = Date.now();
    this.catchUp(now);
    this.runBots(now);
    this.afterStep();
  }

  private runBots(now: number): void {
    if (!this.game) return;
    this.botsDirty = false;
    for (const [id, bot] of this.bots) {
      if (!this.game) return;
      const fresh = eventsFor(this.game.log.slice(bot.seenSeq), id).length > 0;
      if (!fresh && bot.wakeAt > now) continue;
      const view = viewFor(this.game, id, { sinceSeq: bot.seenSeq });
      let decision;
      try {
        decision = decideBot(bot, view, now);
      } catch (e) {
        console.error('Bot decision failed', e);
        this.bots.set(id, { ...bot, seenSeq: view.lastSeq, wakeAt: now + 2000 });
        continue;
      }
      this.bots.set(id, decision.bot);
      for (const intent of decision.intents) this.applyBot(id, intent, now);
      const rewrite =
        this.opts.rewriteSpeech && (this.opts.shouldRewrite?.() ?? true)
          ? this.opts.rewriteSpeech
          : null;
      // The chat layer needs the bot's whole history, not the incremental view.
      const fullView = rewrite && decision.speech.length > 0 ? viewFor(this.game, id) : null;
      for (const speech of decision.speech) {
        if (rewrite && fullView) this.rewriteThenSay(rewrite, decision.bot, fullView, speech);
        else
          this.say(
            id,
            speech,
            { text: speech.intent.text, source: 'scripted', reason: 'off' },
            now,
          );
      }
    }
  }

  private applyBot(id: PlayerId, intent: Intent, now: number): boolean {
    if (!this.game) return false;
    const r = applyIntent(this.game, id, intent, now);
    if (r.error) return false;
    this.game = r.state;
    if (r.events.length > 0) this.botsDirty = true;
    return true;
  }

  private say(id: PlayerId, speech: BotSpeech, result: SpeechRewrite, now: number): void {
    if (!this.game) return;
    const delivered = this.applyBot(id, { ...speech.intent, text: result.text }, now);
    if (this.transcript.length >= MAX_TRANSCRIPT) return;
    this.transcript.push({
      at: now,
      day: this.game.phase.day,
      phase: this.game.phase.kind,
      bot: id,
      name: this.seats.find((s) => s.id === id)?.name ?? id,
      channel: speech.intent.type === 'whisper' ? 'whisper' : speech.intent.channel,
      category: speech.category,
      scripted: speech.intent.text,
      text: result.text,
      source: result.source,
      ...(result.reason ? { reason: result.reason } : {}),
      delivered,
    });
  }

  private rewriteThenSay(
    rewrite: SpeechRewriter,
    bot: BotState,
    view: PlayerView,
    speech: BotSpeech,
  ): void {
    const gen = this.gameGen;
    const scripted = speech.intent.text;
    const timeout = new Promise<SpeechRewrite>((resolve) =>
      setTimeout(
        () => resolve({ text: scripted, source: 'scripted', reason: 'timeout' }),
        SPEECH_TIMEOUT_MS,
      ),
    );
    const written: Promise<SpeechRewrite> = Promise.race([rewrite({ bot, view, speech }), timeout])
      .then((r): SpeechRewrite => {
        if (r && typeof r === 'object' && r.text.trim()) return r;
        if (typeof r === 'string' && r.trim()) return { text: r, source: 'claude' };
        return { text: scripted, source: 'scripted', reason: 'empty' };
      })
      .catch(() => ({ text: scripted, source: 'scripted', reason: 'error' }));
    // Calls run in parallel, but each bot's lines are spoken in order.
    const prev = this.speechChain.get(bot.id) ?? Promise.resolve();
    const next = Promise.all([prev, written]).then(([, result]) => {
      if (gen !== this.gameGen || !this.game || this.closed) return;
      const now = Date.now();
      this.catchUp(now);
      this.say(bot.id, speech, result, now);
      this.afterStep();
    });
    this.speechChain.set(bot.id, next);
  }

  /** Push views, update status, and schedule the next wake-up. */
  private afterStep(): void {
    if (!this.game) return;
    if (this.game.phase.kind === 'ended' && this.status === 'playing') {
      this.status = 'ended';
      this.lobbyChanged();
    }
    this.flushViews();
    this.schedule();
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.game || this.closed) return;
    const now = Date.now();
    const times: number[] = [];
    const deadline = nextDeadline(this.game);
    if (deadline !== null) times.push(deadline);
    for (const bot of this.bots.values()) times.push(bot.wakeAt);
    if (this.botsDirty) times.push(now + BOT_REACT_MS);
    if (times.length === 0) return;
    const at = Math.min(...times);
    this.timer = this.timers.setTimeout(() => this.loop(), Math.max(0, at - now));
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private flushViews(): void {
    if (!this.game) return;
    for (const [playerId, ch] of this.channels) {
      if (playerId === this.hostId) {
        const update = ch.next(this.game);
        if (update) this.store.set({ view: mergeView(this.store.get().view, update) });
        continue;
      }
      const peerId = this.peerOf.get(playerId);
      const peer = peerId ? this.peers.get(peerId) : undefined;
      if (!peer) continue;
      const update = ch.next(this.game);
      if (update) this.sendTo(peer, { t: 'view', ...update, hostNow: Date.now() });
    }
  }

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------

  private attach(t: HostTransport): void {
    this.transport = t;
    t.onPeerOpen = (peer) => {
      this.peers.set(peer, { id: peer, playerId: '', lastSeen: Date.now() });
    };
    t.onPeerClose = (peer) => this.peerGone(peer);
    t.onMessage = (peer, raw) => this.receive(peer, raw);
    t.onError = (error) => this.setNetwork({ state: 'error', error });
  }

  private receive(peerId: string, raw: unknown): void {
    if (this.closed) return;
    let peer = this.peers.get(peerId);
    if (!peer) {
      // Some transports deliver data before announcing the peer.
      peer = { id: peerId, playerId: '', lastSeen: Date.now() };
      this.peers.set(peerId, peer);
    }
    peer.lastSeen = Date.now();
    const msg = parseClientMessage(raw);
    if (!msg) return;
    if (!peer.playerId) {
      if (msg.t === 'hello') this.hello(peer, msg);
      return;
    }
    switch (msg.t) {
      case 'hello':
        return;
      case 'rename':
        this.renameSeat(peer.playerId, msg.name);
        return;
      case 'intent': {
        const error = this.allow(peer.playerId)
          ? this.handleIntent(peer.playerId, msg.intent)
          : 'Slow down a little.';
        if (error) this.sendTo(peer, { t: 'rejected', id: msg.id, error });
        return;
      }
      case 'ping':
        this.sendTo(peer, { t: 'pong', at: msg.at, hostNow: Date.now() });
        return;
      case 'bye':
        this.transport?.drop(peer.id);
        this.peerGone(peer.id);
        return;
    }
  }

  private hello(peer: Peer, msg: Extract<ClientMessage, { t: 'hello' }>): void {
    const reject = (reason: RejectReason) => {
      this.sendTo(peer, { t: 'reject', reason, message: REJECT_MESSAGES[reason] });
      const t = this.transport;
      setTimeout(() => t?.drop(peer.id), 200);
    };
    if (msg.v !== PROTOCOL_VERSION) return reject('version');
    if (this.banned.has(msg.token)) return reject('kicked');
    let playerId = this.tokens.get(msg.token);
    if (!playerId) {
      if (this.status !== 'open') return reject('started');
      if (this.seats.length >= MAX_PLAYERS) {
        // A late friend takes over the last bot seat.
        const bot = [...this.seats].reverse().find((s) => s.kind === 'bot');
        if (!bot) return reject('full');
        this.seats = this.seats.filter((s) => s !== bot);
      }
      playerId = `p-${randomId(4)}`;
      const taken = this.seats.map((s) => s.name);
      this.seats.push({
        id: playerId,
        name: uniqueName(msg.name, taken),
        kind: 'human',
        connected: true,
      });
      this.tokens.set(msg.token, playerId);
      this.channels.set(playerId, new ViewChannel(playerId));
    }
    // One live connection per seat: a newer tab or device replaces the older one.
    const oldPeerId = this.peerOf.get(playerId);
    const oldPeer = oldPeerId ? this.peers.get(oldPeerId) : undefined;
    if (oldPeer && oldPeer.id !== peer.id) {
      this.disconnectPeer(oldPeer, 'replaced', 'You joined this room from another tab or device.');
    }
    peer.playerId = playerId;
    this.peerOf.set(playerId, peer.id);
    const seat = this.seats.find((s) => s.id === playerId);
    if (seat) seat.connected = true;
    this.channels.get(playerId)?.reset();
    this.sendTo(peer, { t: 'welcome', v: PROTOCOL_VERSION, you: playerId, code: this.code });
    this.lobbyChanged();
    this.flushViews();
  }

  private disconnectPeer(peer: Peer, reason: CloseReason, message: string): void {
    this.sendTo(peer, { t: 'closed', reason, message });
    this.peers.delete(peer.id);
    if (this.peerOf.get(peer.playerId) === peer.id) this.peerOf.delete(peer.playerId);
    const t = this.transport;
    setTimeout(() => t?.drop(peer.id), 200);
  }

  private peerGone(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (!peer.playerId || this.peerOf.get(peer.playerId) !== peerId) return;
    this.peerOf.delete(peer.playerId);
    const seat = this.seats.find((s) => s.id === peer.playerId);
    if (seat) seat.connected = false;
    this.lobbyChanged();
  }

  private scheduleSweep(): void {
    this.sweeper = this.timers.setTimeout(() => {
      if (this.closed) return;
      this.sweep();
      this.scheduleSweep();
    }, SWEEP_MS);
  }

  private sweep(): void {
    const cutoff = Date.now() - CLIENT_SILENCE_MS;
    for (const peer of [...this.peers.values()]) {
      if (peer.lastSeen < cutoff) {
        this.transport?.drop(peer.id);
        this.peerGone(peer.id);
      }
    }
  }

  private sendTo(peer: Peer, msg: HostMessage): void {
    this.transport?.send(peer.id, msg);
    if (peer.playerId) this.opts.onSend?.(peer.playerId, msg);
  }

  private allow(playerId: PlayerId): boolean {
    const now = Date.now();
    const b = this.buckets.get(playerId) ?? { tokens: BUCKET_SIZE, at: now };
    b.tokens = Math.min(BUCKET_SIZE, b.tokens + ((now - b.at) / 1000) * BUCKET_REFILL);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(playerId, b);
    return ok;
  }

  private setNetwork(network: NetworkState): NetworkState {
    this.store.set({ network });
    return network;
  }

  // ---------------------------------------------------------------------------
  // Lobby state
  // ---------------------------------------------------------------------------

  private renameSeat(playerId: PlayerId, name: string): void {
    if (this.status !== 'open') return;
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    const taken = this.seats.filter((s) => s !== seat).map((s) => s.name);
    seat.name = uniqueName(name, taken, seat.name);
    this.lobbyChanged();
  }

  private lobby(): LobbyView {
    return lobbyView(this.code, this.hostId, this.status, this.seats, this.settings);
  }

  private lobbyChanged(): void {
    const lobby = this.lobby();
    const status =
      this.status === 'open' ? 'lobby' : this.status === 'playing' ? 'playing' : 'ended';
    if (!this.closed) this.store.set({ lobby, status });
    for (const peer of this.peers.values()) {
      if (peer.playerId) this.sendTo(peer, { t: 'lobby', lobby });
    }
  }
}
