import type { DataConnection, Peer } from 'peerjs';
import type { ClientMessage, HostMessage } from './protocol.ts';
import {
  NetError,
  type ClientTransport,
  type HostTransport,
  type NetErrorCode,
  type Transport,
} from './transport.ts';

/** Public STUN only. PeerJS's default config adds TURN relays, which we don't use. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const ID_PREFIX = 'vesper-room-';
const OPEN_TIMEOUT_MS = 12_000;
/** After the signaling server answers, how long ICE may take before we call it blocked. */
const ICE_TIMEOUT_MS = 15_000;
const SIGNALING_ERRORS = new Set([
  'network',
  'server-error',
  'socket-error',
  'socket-closed',
  'ssl-unavailable',
  'disconnected',
]);

function hasWebRtc(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

async function loadPeer(): Promise<typeof Peer> {
  if (!hasWebRtc()) throw new NetError('unsupported');
  return (await import('peerjs')).Peer;
}

// Messages travel as JSON text. PeerJS's default binary packing costs about
// 25x more than JSON.stringify for a 16-seat view, which made the host's
// fan-out the slowest part of a step.
const encode = (msg: HostMessage | ClientMessage): string => JSON.stringify(msg);

function decode(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function errorCode(type: string): NetErrorCode {
  if (type === 'unavailable-id') return 'roomTaken';
  if (type === 'peer-unavailable') return 'roomNotFound';
  if (type === 'browser-incompatible') return 'unsupported';
  if (SIGNALING_ERRORS.has(type)) return 'signaling';
  return 'connectFailed';
}

class PeerJsHost implements HostTransport {
  onPeerOpen: HostTransport['onPeerOpen'] = null;
  onPeerClose: HostTransport['onPeerClose'] = null;
  onMessage: HostTransport['onMessage'] = null;
  onError: HostTransport['onError'] = null;
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private closed = false;

  constructor(private readonly code: string) {}

  async open(): Promise<void> {
    const PeerCtor = await loadPeer();
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      const peer = new PeerCtor(ID_PREFIX + this.code, {
        config: { iceServers: ICE_SERVERS },
        debug: 0,
      });
      this.peer = peer;
      const timer = setTimeout(() => {
        if (!opened) reject(new NetError('signaling'));
      }, OPEN_TIMEOUT_MS);
      peer.on('open', () => {
        opened = true;
        clearTimeout(timer);
        resolve();
      });
      peer.on('error', (err) => {
        const code = errorCode(err.type);
        if (!opened) {
          clearTimeout(timer);
          reject(new NetError(code));
        } else if (code === 'signaling' && !this.closed) {
          this.onError?.(new NetError('signaling'));
        }
      });
      // The signaling socket can drop while games run; existing players stay
      // connected, but new joins need the room id registered again.
      peer.on('disconnected', () => {
        if (opened && !this.closed) setTimeout(() => !this.closed && peer.reconnect(), 1000);
      });
      peer.on('connection', (conn) => this.wire(conn));
    });
  }

  private wire(conn: DataConnection): void {
    conn.on('open', () => {
      if (this.closed) return conn.close();
      this.conns.set(conn.peer, conn);
      this.onPeerOpen?.(conn.peer);
    });
    conn.on('data', (data) => {
      if (this.conns.get(conn.peer) === conn) this.onMessage?.(conn.peer, decode(data));
    });
    conn.on('close', () => {
      if (this.conns.get(conn.peer) !== conn) return;
      this.conns.delete(conn.peer);
      this.onPeerClose?.(conn.peer);
    });
    conn.on('error', () => conn.close());
  }

  send(peer: string, msg: HostMessage): void {
    const conn = this.conns.get(peer);
    if (conn?.open) void conn.send(encode(msg));
  }

  drop(peer: string): void {
    this.conns.get(peer)?.close();
  }

  close(): void {
    this.closed = true;
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

class PeerJsClient implements ClientTransport {
  onMessage: ClientTransport['onMessage'] = null;
  onClose: ClientTransport['onClose'] = null;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private closed = false;

  constructor(private readonly code: string) {}

  async connect(): Promise<void> {
    const PeerCtor = await loadPeer();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = setTimeout(
        () => fail(new NetError('signaling')),
        OPEN_TIMEOUT_MS,
      );
      const fail = (err: NetError) => {
        if (timer) clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(err);
      };
      const peer = new PeerCtor({ config: { iceServers: ICE_SERVERS }, debug: 0 });
      this.peer = peer;
      peer.on('error', (err) => {
        if (!settled) fail(new NetError(errorCode(err.type)));
      });
      peer.on('open', () => {
        if (timer) clearTimeout(timer);
        const conn = peer.connect(ID_PREFIX + this.code, { reliable: true });
        this.conn = conn;
        // The server reports a missing room within a second (peer-unavailable).
        // If that never comes and no host answered either, "found the host but
        // could not connect" would be wrong.
        const connFailed = () =>
          fail(
            new NetError(conn.peerConnection?.remoteDescription ? 'connectFailed' : 'roomNotFound'),
          );
        timer = setTimeout(connFailed, ICE_TIMEOUT_MS);
        conn.on('open', () => {
          if (timer) clearTimeout(timer);
          if (settled) return;
          settled = true;
          // The signaling socket is only needed to find the host.
          peer.disconnect();
          resolve();
        });
        conn.on('data', (data) => this.onMessage?.(decode(data)));
        conn.on('close', () => {
          if (!settled) return connFailed();
          if (this.closed) return;
          this.closed = true;
          this.onClose?.();
        });
        conn.on('error', () => {
          if (!settled) connFailed();
        });
      });
    }).catch((e: unknown) => {
      this.teardown();
      throw e;
    });
  }

  send(msg: ClientMessage): void {
    if (this.conn?.open) void this.conn.send(encode(msg));
  }

  close(): void {
    this.closed = true;
    this.teardown();
  }

  private teardown(): void {
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
  }
}

/** PeerJS over the free public PeerJS cloud server. The host owns the id `vesper-room-<CODE>`. */
export const peerJsTransport: Transport = {
  name: 'peerjs',
  host: (code) => new PeerJsHost(code),
  client: (code) => new PeerJsClient(code),
};
