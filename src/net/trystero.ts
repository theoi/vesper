import type { JsonValue, Room } from 'trystero';
import { ICE_SERVERS } from './peerjs.ts';
import type { ClientMessage, HostMessage } from './protocol.ts';
import { NetError, type ClientTransport, type HostTransport, type Transport } from './transport.ts';

const APP_ID = 'vesper-social-deduction';
/**
 * Nostr relays for signaling. Trystero otherwise picks 5 of its built-in relays from the app id,
 * and for ours that meant one that refused connections, one that blocks the ephemeral event kinds
 * Trystero uses, and one that rate-limits. These accept kinds 20000-29999 from an unknown key,
 * deliver them to subscribers, and took a 40-event burst without limits.
 * `tests/e2e/nostr-relays.spec.ts` checks they still do.
 */
export const NOSTR_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://cdn.satellite.earth',
  'wss://relay.nostr.net',
];
/** Trystero can't tell "no such room" from "slow"; give up after this long. */
const FIND_HOST_TIMEOUT_MS = 8000;

type Wire = { k: 'host' } | { k: 'msg'; m: JsonValue };

async function join(code: string): Promise<Room> {
  if (typeof RTCPeerConnection === 'undefined') throw new NetError('unsupported');
  const { joinRoom } = await import('trystero');
  return joinRoom(
    { appId: APP_ID, rtcConfig: { iceServers: ICE_SERVERS }, relayConfig: { urls: NOSTR_RELAYS } },
    `room-${code}`,
  );
}

class TrysteroHost implements HostTransport {
  onPeerOpen: HostTransport['onPeerOpen'] = null;
  onPeerClose: HostTransport['onPeerClose'] = null;
  onMessage: HostTransport['onMessage'] = null;
  onError: HostTransport['onError'] = null;
  private room: Room | null = null;
  private send_: ((data: Wire, target: string) => void) | null = null;
  private peers = new Set<string>();

  constructor(private readonly code: string) {}

  async open(): Promise<void> {
    const room = await join(this.code);
    this.room = room;
    const action = room.makeAction<Wire>('v');
    this.send_ = (data, target) => void action.send(data, { target });
    room.onPeerJoin = (peer) => {
      this.peers.add(peer);
      action.send({ k: 'host' }, { target: peer }).catch(() => undefined);
      this.onPeerOpen?.(peer);
    };
    room.onPeerLeave = (peer) => {
      if (this.peers.delete(peer)) this.onPeerClose?.(peer);
    };
    action.onMessage = (data, { peerId }) => {
      if (data && typeof data === 'object' && data.k === 'msg') this.onMessage?.(peerId, data.m);
    };
  }

  send(peer: string, msg: HostMessage): void {
    if (this.peers.has(peer)) this.send_?.({ k: 'msg', m: msg as unknown as JsonValue }, peer);
  }

  drop(peer: string): void {
    // Trystero can't close one peer; forget it so its messages are ignored.
    if (this.peers.delete(peer)) this.onPeerClose?.(peer);
  }

  close(): void {
    this.peers.clear();
    void this.room?.leave();
    this.room = null;
  }
}

class TrysteroClient implements ClientTransport {
  onMessage: ClientTransport['onMessage'] = null;
  onClose: ClientTransport['onClose'] = null;
  private room: Room | null = null;
  private hostPeer: string | null = null;
  private send_: ((data: Wire, target: string) => void) | null = null;
  private closed = false;

  constructor(private readonly code: string) {}

  async connect(): Promise<void> {
    const room = await join(this.code);
    this.room = room;
    const action = room.makeAction<Wire>('v');
    this.send_ = (data, target) => void action.send(data, { target });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new NetError('roomNotFound')), FIND_HOST_TIMEOUT_MS);
      action.onMessage = (data, { peerId }) => {
        if (!data || typeof data !== 'object') return;
        // Only the host announces itself; other players in the mesh are ignored.
        if (data.k === 'host' && !this.hostPeer) {
          this.hostPeer = peerId;
          clearTimeout(timer);
          resolve();
        } else if (data.k === 'msg' && peerId === this.hostPeer) {
          this.onMessage?.(data.m);
        }
      };
      room.onPeerLeave = (peer) => {
        if (peer !== this.hostPeer || this.closed) return;
        this.closed = true;
        this.onClose?.();
      };
    }).catch((e: unknown) => {
      this.close();
      throw e;
    });
  }

  send(msg: ClientMessage): void {
    if (this.hostPeer) this.send_?.({ k: 'msg', m: msg as unknown as JsonValue }, this.hostPeer);
  }

  close(): void {
    this.closed = true;
    void this.room?.leave();
    this.room = null;
  }
}

/** Trystero over public Nostr relays. Used as the fallback when PeerJS is unreachable. */
export const trysteroTransport: Transport = {
  name: 'trystero-nostr',
  host: (code) => new TrysteroHost(code),
  client: (code) => new TrysteroClient(code),
};
