import {
  ChatLayer,
  STORAGE_KEYS,
  clearSettings,
  loadSettings,
  saveSettings,
  type ChatLimits,
  type ChatStatus,
  type FetchLike,
  type KeyValueStore,
} from '../bots/llm/index.ts';
import type { Ballot, Intent, PlayerId } from '../engine/index.ts';
import {
  ClientSession,
  HostSession,
  normalizeCode,
  roomLink,
  saveName,
  savedName,
  type BotLine,
  type GameSession,
  type HostMessage,
  type LobbySettings,
  type SessionSnapshot,
  type Transport,
} from '../net/index.ts';

/**
 * App controller: the one object a UI talks to. It owns the current session
 * (hosting, joined, or none) and exposes an observable state plus actions.
 * Renderers subscribe to `AppState` and call these methods; they never touch
 * the network or engine directly, so the UI can be replaced freely.
 */

export type Screen = 'home' | 'room';

export interface AppState {
  screen: Screen;
  /** Last name used on this browser. */
  name: string;
  /** Room code from the URL, if the page was opened from a share link. */
  linkCode: string | null;
  /** Shareable link for the current room. */
  link: string | null;
  /** Error to show on the home screen (bad code, etc.). */
  homeError: string | null;
  session: SessionSnapshot | null;
  /** Claude bot chat (host only). Never contains the API key. */
  claude: ClaudeState;
}

export interface ClaudeState {
  status: ChatStatus;
  hasKey: boolean;
  /** The key is stored in this browser's localStorage (the host chose "remember"). */
  remembered: boolean;
  enabled: boolean;
  model: string;
  workspaceId: string | null;
  callsThisGame: number;
  maxCallsPerGame: number;
  /** Bot lines offered to Claude this game, and how many Claude wrote. */
  lines: number;
  claudeLines: number;
  costUsd: number | null;
}

export interface ControllerOptions {
  transport: () => Transport;
  /** Base URL for share links (defaults to the current page). */
  baseUrl?: string;
  linkCode?: string | null;
  /** Record every message received from the host (tests and debugging). */
  recordNet?: boolean;
  /** Keep the URL in sync with the joined room so a reload rejoins. */
  onRoomUrl?: (code: string | null) => void;
  /** Where Claude settings persist (localStorage in the browser). */
  storage?: KeyValueStore | null;
  claudeLimits?: Partial<ChatLimits>;
  /** For tests: replaces fetch for Anthropic calls. */
  claudeFetch?: FetchLike;
}

type Listener = (state: AppState) => void;

export class AppController {
  private state: AppState;
  private session: GameSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<Listener>();
  /** Every message this browser received from a host, when recording is on. */
  readonly netLog: { at: number; msg: HostMessage }[] = [];
  /** The Claude chat layer. It holds the key privately; nothing else does. */
  private readonly chatLayer: ChatLayer;

  constructor(private readonly opts: ControllerOptions) {
    const stored = opts.storage ? loadSettings(opts.storage) : {};
    this.chatLayer = new ChatLayer({
      ...stored,
      ...opts.claudeLimits,
      ...(opts.claudeFetch ? { fetch: opts.claudeFetch } : {}),
    });
    this.state = {
      screen: 'home',
      name: savedName(),
      linkCode: opts.linkCode ?? null,
      link: null,
      homeError: null,
      session: null,
      claude: this.claudeState(),
    };
    this.chatLayer.subscribe(() => this.refreshClaude());
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l(this.state);
  }

  /** The current host session, if this browser is hosting. */
  get host(): HostSession | null {
    return this.session instanceof HostSession ? this.session : null;
  }

  // ---------------------------------------------------------------------------
  // Rooms
  // ---------------------------------------------------------------------------

  /** Host a room. `online: false` plays solo with bots and never touches the network. */
  async hostRoom(name: string, opts: { online: boolean; seats?: number } = { online: true }) {
    this.rememberName(name);
    const host = new HostSession({
      hostName: name,
      transport: opts.online ? this.opts.transport() : null,
      rewriteSpeech: async ({ view, speech }) => {
        const r = await this.chatLayer.rewrite(view, speech);
        const reason = r.rule ? `guardrail:${r.rule}` : r.reason;
        return { text: r.text, source: r.source, ...(reason ? { reason } : {}) };
      },
      shouldRewrite: () => this.chatLayer.settings.hasKey && this.chatLayer.settings.enabled,
      onGameStart: () => {
        this.chatLayer.newGame();
        this.chatLayer.resetMetrics();
        this.refreshClaude();
      },
    });
    if (opts.seats) host.fillWithBots(opts.seats);
    this.attach(host);
    await host.open();
  }

  /** Join a room by code or link. */
  async joinRoom(codeOrLink: string, name: string): Promise<void> {
    const code = parseCode(codeOrLink);
    if (!code) {
      this.set({ homeError: 'That is not a valid room code. Codes are 5 letters and numbers.' });
      return;
    }
    this.rememberName(name);
    const client = new ClientSession({
      code,
      name,
      transport: this.opts.transport(),
      ...(this.opts.recordNet
        ? { onReceive: (msg: HostMessage) => this.netLog.push({ at: Date.now(), msg }) }
        : {}),
    });
    this.attach(client);
    this.opts.onRoomUrl?.(code);
    await client.join();
  }

  /** Leave the room (as host, this ends the game for everyone) and go home. */
  leaveRoom(): void {
    this.session?.leave();
    this.detach();
    this.opts.onRoomUrl?.(null);
    this.set({ screen: 'home', session: null, link: null, linkCode: null });
  }

  /** From a closed or failed room back to the home screen. */
  goHome(): void {
    this.leaveRoom();
  }

  private attach(session: GameSession): void {
    this.detach();
    this.session = session;
    this.unsubscribe = session.subscribe((snap) => this.onSnapshot(snap));
    this.set({ screen: 'room', homeError: null });
    this.onSnapshot(session.snapshot());
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = null;
  }

  private onSnapshot(snap: SessionSnapshot): void {
    const link =
      snap.isHost && snap.network.state !== 'open' ? null : roomLink(snap.code, this.opts.baseUrl);
    this.set({ session: snap, link, claude: this.claudeState() });
    if (snap.status === 'closed' || snap.status === 'error') this.opts.onRoomUrl?.(null);
  }

  private rememberName(name: string): void {
    const clean = name.trim();
    if (clean) saveName(clean);
    this.set({ name: clean });
  }

  // ---------------------------------------------------------------------------
  // Lobby
  // ---------------------------------------------------------------------------

  rename(name: string): void {
    this.rememberName(name);
    this.session?.rename(name);
  }

  addBot(count = 1): void {
    this.host?.addBot(count);
  }

  fillWithBots(total: number): void {
    this.host?.fillWithBots(total);
  }

  removeSeat(playerId: PlayerId): void {
    this.host?.removeSeat(playerId);
  }

  updateSettings(patch: Partial<LobbySettings>): void {
    this.host?.updateSettings(patch);
  }

  /** Start the game; returns an error message if it can't start. */
  start(): string | null {
    return this.host ? this.host.start() : 'Only the host can start the game.';
  }

  backToLobby(): void {
    this.host?.backToLobby();
  }

  // ---------------------------------------------------------------------------
  // Claude bot chat (host only)
  // ---------------------------------------------------------------------------

  /**
   * Use this Anthropic API key for bot chat. It stays in this browser: in
   * memory, and in localStorage only if `remember` is true. It is never sent
   * to other players.
   */
  setClaudeKey(key: string | null, opts: { remember?: boolean } = {}): void {
    this.chatLayer.configure({ apiKey: key });
    if (this.opts.storage) {
      saveSettings(this.opts.storage, { apiKey: key }, opts.remember ?? false);
    }
    this.refreshClaude();
  }

  setClaudeSettings(patch: {
    model?: string;
    workspaceId?: string | null;
    enabled?: boolean;
  }): void {
    this.chatLayer.configure(patch);
    if (this.opts.storage) {
      const s = this.chatLayer.settings;
      const remembered = this.opts.storage.getItem(STORAGE_KEYS.apiKey) !== null;
      saveSettings(
        this.opts.storage,
        {
          model: s.model,
          workspaceId: s.workspaceId,
          enabled: s.enabled,
          apiKey: remembered ? this.opts.storage.getItem(STORAGE_KEYS.apiKey) : null,
        },
        remembered,
      );
    }
    this.refreshClaude();
  }

  /** Send one tiny request to check the key. Resolves with the new status. */
  async testClaude(): Promise<ChatStatus> {
    const status = await this.chatLayer.check();
    this.refreshClaude();
    return status;
  }

  /** Remove the key from memory and from this browser. */
  forgetClaude(): void {
    this.chatLayer.configure({ apiKey: null });
    if (this.opts.storage) clearSettings(this.opts.storage);
    this.refreshClaude();
  }

  /** This game's bot lines, each tagged with whether Claude wrote it (host only). */
  botTranscript(): BotLine[] {
    return this.host?.botLines() ?? [];
  }

  private claudeState(): ClaudeState {
    const s = this.chatLayer.settings;
    const m = this.chatLayer.metrics();
    return {
      status: this.chatLayer.status(),
      hasKey: s.hasKey,
      remembered: this.opts.storage?.getItem(STORAGE_KEYS.apiKey) != null,
      enabled: s.enabled,
      model: s.model,
      workspaceId: s.workspaceId,
      callsThisGame: this.chatLayer.callsThisGame,
      maxCallsPerGame: this.chatLayer.limits.maxCallsPerGame,
      lines: m.lines,
      claudeLines: m.claude,
      costUsd: m.costUsd,
    };
  }

  private refreshClaude(): void {
    this.set({ claude: this.claudeState() });
  }

  // ---------------------------------------------------------------------------
  // Game intents
  // ---------------------------------------------------------------------------

  send(intent: Intent): number | null {
    return this.session ? this.session.sendIntent(intent) : null;
  }

  chat(channel: 'public' | 'mafia' | 'dead', text: string) {
    return this.send({ type: 'chat', channel, text });
  }
  whisper(to: PlayerId, text: string) {
    return this.send({ type: 'whisper', to, text });
  }
  vote(target: PlayerId | null) {
    return this.send({ type: 'vote', target });
  }
  judge(ballot: Ballot) {
    return this.send({ type: 'judge', ballot });
  }
  nightAction(targets: PlayerId[] | null) {
    return this.send({ type: 'night', targets });
  }
  reveal() {
    return this.send({ type: 'reveal' });
  }
  setWill(text: string) {
    return this.send({ type: 'will', text });
  }
  setDeathNote(text: string) {
    return this.send({ type: 'deathNote', text });
  }
  ready(ready: boolean) {
    return this.send({ type: 'ready', ready });
  }
}

/** Accepts a bare code or a full share link. */
export function parseCode(input: string): string | null {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const raw =
        url.searchParams.get('room') ?? new URLSearchParams(url.hash.slice(1)).get('room');
      return raw ? normalizeCode(raw) : null;
    } catch {
      return null;
    }
  }
  return normalizeCode(trimmed);
}
