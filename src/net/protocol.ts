import type { Intent, PlayerId } from '../engine/index.ts';
import type { LobbyView } from './lobby.ts';
import type { ViewUpdate } from './session.ts';

/** Bump when host and client can no longer understand each other. */
export const PROTOCOL_VERSION = 2;

/** Messages a client sends to the host. */
export type ClientMessage =
  | { t: 'hello'; v: number; token: string; name: string }
  | { t: 'rename'; name: string }
  | { t: 'intent'; id: number; intent: Intent }
  | { t: 'ping'; at: number }
  | { t: 'bye' };

export type RejectReason = 'full' | 'started' | 'version' | 'kicked' | 'badHello';

export type CloseReason =
  /** The host closed the room or left the page. */
  | 'hostLeft'
  /** The same player connected from another tab or device. */
  | 'replaced'
  | 'kicked';

/** Messages the host sends to one client. Each carries only what that client may see. */
export type HostMessage =
  | { t: 'welcome'; v: number; you: PlayerId; code: string }
  | { t: 'reject'; reason: RejectReason; message: string }
  | { t: 'lobby'; lobby: LobbyView }
  | ({
      t: 'view';
      /** Host clock when sent, so clients can show phase timers in host time. */
      hostNow: number;
      /**
       * `full`: the whole view with every event so far (join, rejoin, new game).
       * Otherwise a patch: new events and only the fields that changed.
       */
    } & ViewUpdate)
  | { t: 'rejected'; id: number; error: string }
  | { t: 'pong'; at: number; hostNow: number }
  | { t: 'closed'; reason: CloseReason; message: string };

const MAX_TOKEN = 64;
const MAX_NAME_INPUT = 64;
const MAX_TEXT = 2000;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Validate a message from an untrusted client. Returns null for anything
 * malformed. Intent contents are checked again by the engine.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObject(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'hello':
      if (typeof raw.v !== 'number' || typeof raw.token !== 'string') return null;
      if (raw.token.length < 8 || raw.token.length > MAX_TOKEN) return null;
      if (typeof raw.name !== 'string' || raw.name.length > MAX_NAME_INPUT) return null;
      return { t: 'hello', v: raw.v, token: raw.token, name: raw.name };
    case 'rename':
      if (typeof raw.name !== 'string' || raw.name.length > MAX_NAME_INPUT) return null;
      return { t: 'rename', name: raw.name };
    case 'intent': {
      if (typeof raw.id !== 'number' || !isObject(raw.intent)) return null;
      if (typeof raw.intent.type !== 'string') return null;
      if (JSON.stringify(raw.intent).length > MAX_TEXT + 500) return null;
      return { t: 'intent', id: raw.id, intent: raw.intent as unknown as Intent };
    }
    case 'ping':
      return typeof raw.at === 'number' ? { t: 'ping', at: raw.at } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

/** Light shape check for messages from the host. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObject(raw) || typeof raw.t !== 'string') return null;
  const known = ['welcome', 'reject', 'lobby', 'view', 'rejected', 'pong', 'closed'];
  return known.includes(raw.t) ? (raw as unknown as HostMessage) : null;
}
