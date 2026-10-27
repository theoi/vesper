import {
  viewFor,
  type GameState,
  type Intent,
  type PlayerId,
  type PlayerView,
} from '../engine/index.ts';
import type { LobbyView } from './lobby.ts';
import type { NetError } from './transport.ts';

export type SessionStatus =
  /** Client: reaching the host for the first time. */
  | 'connecting'
  /** Client: lost the host and trying to get back. */
  | 'reconnecting'
  | 'lobby'
  | 'playing'
  /** The game is over; the room stays open. */
  | 'ended'
  /** The room is gone: the host left, or you were removed. See `notice`. */
  | 'closed'
  /** Could not join. See `notice`. */
  | 'error';

/** Whether friends can reach a host's room. */
export type NetworkState =
  | { state: 'offline' }
  | { state: 'opening' }
  | { state: 'open' }
  | { state: 'error'; error: NetError };

export interface Notice {
  code: string;
  message: string;
}

/** Everything a screen needs to render one player's session. Same shape for host and client. */
export interface SessionSnapshot {
  isHost: boolean;
  status: SessionStatus;
  code: string;
  you: PlayerId | null;
  lobby: LobbyView | null;
  /** Latest view; `events` holds every event this player has received this game. */
  view: PlayerView | null;
  /** Add to `Date.now()` to get host time, which phase timers (`endsAt`) use. */
  clockOffset: number;
  network: NetworkState;
  notice: Notice | null;
  lastRejection: { id: number; error: string } | null;
}

/** What the UI talks to, for both the host's own seat and a remote player. */
export interface GameSession {
  readonly isHost: boolean;
  snapshot(): SessionSnapshot;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
  /** Send a game intent; returns an id that `lastRejection.id` refers to. */
  sendIntent(intent: Intent): number;
  rename(name: string): void;
  leave(): void;
}

export class Store {
  private listeners = new Set<(s: SessionSnapshot) => void>();
  constructor(private current: SessionSnapshot) {}
  get(): SessionSnapshot {
    return this.current;
  }
  set(patch: Partial<SessionSnapshot>): void {
    this.current = { ...this.current, ...patch };
    for (const l of [...this.listeners]) l(this.current);
  }
  subscribe(listener: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Fold an update from the host into the previous view. */
export function mergeView(
  prev: PlayerView | null,
  update: { full: boolean; view: PlayerView },
): PlayerView {
  if (update.full || !prev) return update.view;
  const fresh = update.view.events.filter((e) => e.seq > prev.lastSeq);
  return { ...update.view, events: prev.events.concat(fresh) };
}

/**
 * Host-side stream of one player's view. Sends only what changed, and
 * renumbers events per player so gaps in `seq` don't reveal that hidden
 * events (another player's night action, Syndicate chat) happened.
 */
export class ViewChannel {
  private sentSeq = 0;
  private clientSeq = 0;
  private lastKey: string | null = null;

  constructor(readonly playerId: PlayerId) {}

  /** Make the next update a full resync. */
  reset(): void {
    this.sentSeq = 0;
    this.clientSeq = 0;
    this.lastKey = null;
  }

  /** The next update for this player, or null if nothing they can see changed. */
  next(state: GameState): { full: boolean; view: PlayerView } | null {
    const full = this.lastKey === null;
    const {
      events,
      lastSeq: _lastSeq,
      ...rest
    } = viewFor(state, this.playerId, {
      sinceSeq: this.sentSeq,
    });
    this.sentSeq = state.seq;
    const key = JSON.stringify(rest);
    if (!full && events.length === 0 && key === this.lastKey) return null;
    this.lastKey = key;
    const renumbered = events.map((e) => ({ ...e, seq: ++this.clientSeq }));
    return { full, view: { ...rest, events: renumbered, lastSeq: this.clientSeq } };
  }
}
