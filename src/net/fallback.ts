import type { ClientMessage, HostMessage } from './protocol.ts';
import {
  NetError,
  toNetError,
  type ClientTransport,
  type HostTransport,
  type Transport,
} from './transport.ts';

/**
 * Opens the room on every transport at once; clients try them in order.
 * Peer ids are prefixed with the transport's index so the host can route replies.
 */
export function fallbackTransport(transports: readonly Transport[]): Transport {
  return {
    name: transports.map((t) => t.name).join('+'),
    host: (code) => new FallbackHost(transports.map((t) => t.host(code))),
    client: (code) => new FallbackClient(transports.map((t) => () => t.client(code))),
  };
}

class FallbackHost implements HostTransport {
  onPeerOpen: HostTransport['onPeerOpen'] = null;
  onPeerClose: HostTransport['onPeerClose'] = null;
  onMessage: HostTransport['onMessage'] = null;
  onError: HostTransport['onError'] = null;
  private live: (HostTransport | null)[] = [];

  constructor(private readonly parts: HostTransport[]) {}

  async open(): Promise<void> {
    const results = await Promise.allSettled(this.parts.map((p) => p.open()));
    this.live = this.parts.map((p, i) => (results[i]?.status === 'fulfilled' ? p : null));
    this.live.forEach((p, i) => {
      if (!p) return;
      p.onPeerOpen = (peer) => this.onPeerOpen?.(`${i}:${peer}`);
      p.onPeerClose = (peer) => this.onPeerClose?.(`${i}:${peer}`);
      p.onMessage = (peer, msg) => this.onMessage?.(`${i}:${peer}`, msg);
      p.onError = (err) => {
        if (this.live.filter(Boolean).length <= 1) this.onError?.(err);
      };
    });
    this.parts.forEach((p, i) => {
      if (!this.live[i]) p.close();
    });
    if (this.live.some(Boolean)) return;
    // The primary transport's error is the most specific (e.g. a taken room code).
    const first = results.find((r) => r.status === 'rejected');
    throw toNetError(first?.status === 'rejected' ? first.reason : null);
  }

  private route(peer: string): [HostTransport | null, string] {
    const at = peer.indexOf(':');
    return [this.live[Number(peer.slice(0, at))] ?? null, peer.slice(at + 1)];
  }

  send(peer: string, msg: HostMessage): void {
    const [t, id] = this.route(peer);
    t?.send(id, msg);
  }

  drop(peer: string): void {
    const [t, id] = this.route(peer);
    t?.drop(id);
  }

  close(): void {
    for (const p of this.live) p?.close();
    this.live = [];
  }
}

class FallbackClient implements ClientTransport {
  onMessage: ClientTransport['onMessage'] = null;
  onClose: ClientTransport['onClose'] = null;
  private active: ClientTransport | null = null;

  constructor(private readonly makers: (() => ClientTransport)[]) {}

  async connect(): Promise<void> {
    let firstError: NetError | null = null;
    for (const make of this.makers) {
      const t = make();
      t.onMessage = (msg) => this.onMessage?.(msg);
      t.onClose = () => this.onClose?.();
      try {
        await t.connect();
        this.active = t;
        return;
      } catch (e) {
        t.close();
        const err = toNetError(e);
        firstError ??= err;
        // A browser without WebRTC fails the same way everywhere.
        if (err.code === 'unsupported') break;
      }
    }
    throw firstError ?? new NetError('signaling');
  }

  send(msg: ClientMessage): void {
    this.active?.send(msg);
  }

  close(): void {
    this.active?.close();
    this.active = null;
  }
}
