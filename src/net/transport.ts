import type { ClientMessage, HostMessage } from './protocol.ts';

export type NetErrorCode =
  /** The browser has no WebRTC support. */
  | 'unsupported'
  /** The public signaling service could not be reached. */
  | 'signaling'
  /** Host: another room already uses this code. */
  | 'roomTaken'
  /** Client: nobody is hosting this code (wrong code, or the host left). */
  | 'roomNotFound'
  /** The peers found each other but could not open a direct connection. */
  | 'connectFailed'
  | 'timeout';

export class NetError extends Error {
  readonly code: NetErrorCode;
  constructor(code: NetErrorCode, message: string = NET_ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'NetError';
    this.code = code;
  }
}

export const NET_ERROR_MESSAGES: Record<NetErrorCode, string> = {
  unsupported: 'This browser does not support WebRTC, which online play needs.',
  signaling:
    'Could not reach the matchmaking service. Check your internet connection and try again.',
  roomTaken: 'That room code is already in use.',
  roomNotFound: 'No game is open with that code. Check the code, or ask the host for a new link.',
  connectFailed:
    'Found the host but could not connect directly. A strict network (some offices, schools, or VPNs) may be blocking peer-to-peer connections.',
  timeout: 'Connecting took too long. Check your internet connection and try again.',
};

export function toNetError(e: unknown, fallback: NetErrorCode = 'signaling'): NetError {
  return e instanceof NetError ? e : new NetError(fallback);
}

/** The host side of a room: accepts many clients. */
export interface HostTransport {
  /** Resolves once friends can find the room. Rejects with a NetError. */
  open(): Promise<void>;
  send(peer: string, msg: HostMessage): void;
  /** Disconnect one peer. */
  drop(peer: string): void;
  close(): void;
  onPeerOpen: ((peer: string) => void) | null;
  onPeerClose: ((peer: string) => void) | null;
  onMessage: ((peer: string, msg: unknown) => void) | null;
  /** The room stopped being reachable after `open` succeeded. */
  onError: ((err: NetError) => void) | null;
}

/** The client side of a room: one connection to the host. */
export interface ClientTransport {
  /** Resolves once the channel to the host is open. Rejects with a NetError. */
  connect(): Promise<void>;
  send(msg: ClientMessage): void;
  close(): void;
  onMessage: ((msg: unknown) => void) | null;
  /** The channel to the host closed (not called after `close()`). */
  onClose: (() => void) | null;
}

export interface Transport {
  readonly name: string;
  host(code: string): HostTransport;
  client(code: string): ClientTransport;
}
