import type { ClientMessage, HostMessage } from './protocol.ts';
import { NetError, type ClientTransport, type HostTransport, type Transport } from './transport.ts';

/**
 * In-process transport for unit tests. Messages are JSON round-tripped and
 * delivered asynchronously, like a real data channel.
 */
export interface MemoryNetwork extends Transport {
  /** Abruptly cut a client's connection, as if its network dropped. */
  cut(client: ClientTransport): void;
  /** Make the next connect attempts fail with this error. */
  failNext(err: NetError | null): void;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const later = (fn: () => void) => setTimeout(fn, 0);

export function createMemoryNetwork(): MemoryNetwork {
  const hosts = new Map<string, MemoryHost>();
  let failure: NetError | null = null;
  let nextPeer = 1;

  class MemoryHost implements HostTransport {
    onPeerOpen: HostTransport['onPeerOpen'] = null;
    onPeerClose: HostTransport['onPeerClose'] = null;
    onMessage: HostTransport['onMessage'] = null;
    onError: HostTransport['onError'] = null;
    readonly peers = new Map<string, MemoryClient>();
    constructor(readonly code: string) {}

    async open(): Promise<void> {
      if (hosts.has(this.code)) throw new NetError('roomTaken');
      hosts.set(this.code, this);
    }
    send(peer: string, msg: HostMessage): void {
      const c = this.peers.get(peer);
      if (!c) return;
      const data = clone(msg);
      later(() => c.deliver(data));
    }
    drop(peer: string): void {
      const c = this.peers.get(peer);
      if (!c) return;
      this.peers.delete(peer);
      later(() => c.closedByRemote());
    }
    close(): void {
      if (hosts.get(this.code) === this) hosts.delete(this.code);
      for (const peer of [...this.peers.keys()]) this.drop(peer);
    }
    attach(c: MemoryClient): string {
      const peer = `peer-${nextPeer++}`;
      this.peers.set(peer, c);
      later(() => this.onPeerOpen?.(peer));
      return peer;
    }
    receive(peer: string, msg: unknown): void {
      if (this.peers.has(peer)) this.onMessage?.(peer, msg);
    }
    detach(peer: string): void {
      if (this.peers.delete(peer)) later(() => this.onPeerClose?.(peer));
    }
  }

  class MemoryClient implements ClientTransport {
    onMessage: ClientTransport['onMessage'] = null;
    onClose: ClientTransport['onClose'] = null;
    private host: MemoryHost | null = null;
    private peer: string | null = null;
    constructor(readonly code: string) {}

    async connect(): Promise<void> {
      await new Promise((r) => later(() => r(null)));
      if (failure) {
        const err = failure;
        failure = null;
        throw err;
      }
      const host = hosts.get(this.code);
      if (!host) throw new NetError('roomNotFound');
      this.host = host;
      this.peer = host.attach(this);
    }
    send(msg: ClientMessage): void {
      const { host, peer } = this;
      if (!host || !peer) return;
      const data = clone(msg);
      later(() => host.receive(peer, data));
    }
    close(): void {
      const { host, peer } = this;
      this.host = null;
      this.peer = null;
      if (host && peer) host.detach(peer);
    }
    deliver(msg: unknown): void {
      if (this.host) this.onMessage?.(msg);
    }
    closedByRemote(): void {
      if (!this.host) return;
      this.host = null;
      this.peer = null;
      this.onClose?.();
    }
    cut(): void {
      const { host, peer } = this;
      if (!host || !peer) return;
      host.detach(peer);
      this.closedByRemote();
    }
  }

  return {
    name: 'memory',
    host: (code) => new MemoryHost(code),
    client: (code) => new MemoryClient(code),
    cut: (client) => (client as MemoryClient).cut(),
    failNext: (err) => {
      failure = err;
    },
  };
}
