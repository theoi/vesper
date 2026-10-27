/**
 * Online play: host-authoritative rooms over WebRTC.
 *
 * The host's browser runs the engine and bots (`HostSession`). Remote players
 * connect with `ClientSession`. Both implement `GameSession`, which is all the
 * UI needs: subscribe to snapshots and send intents.
 */
import { fallbackTransport } from './fallback.ts';
import { peerJsTransport } from './peerjs.ts';
import type { Transport } from './transport.ts';
import { trysteroTransport } from './trystero.ts';

export * from './session.ts';
export * from './transport.ts';
export * from './protocol.ts';
export * from './lobby.ts';
export * from './room.ts';
export { HostSession, type HostOptions, type SpeechRewriter } from './host.ts';
export { ClientSession, roomToken, type ClientOptions } from './client.ts';
export { playerToken, savedName, saveName } from './identity.ts';
export { fallbackTransport, peerJsTransport, trysteroTransport };

/** PeerJS cloud first, Trystero over Nostr relays if the PeerJS server can't be reached. */
export function defaultTransport(): Transport {
  return fallbackTransport([peerJsTransport, trysteroTransport]);
}

/** Pick a transport by name (`?net=peerjs`, `?net=trystero-nostr`); used for testing. */
export function transportByName(name: string | null): Transport {
  if (name === 'peerjs') return peerJsTransport;
  if (name === 'trystero-nostr') return trysteroTransport;
  return defaultTransport();
}
