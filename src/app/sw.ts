import { ASSET_CACHE, deleteCaches, isHashedAsset, respond } from './assetCache.ts';

// Service worker entry, built to `<base>sw.js` (see vite.config.ts). It only
// answers hashed build files; pages, HTML, and other origins go straight to
// the network.

interface ExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface MessageEvent extends ExtendableEvent {
  readonly data: unknown;
}
interface WorkerScope {
  registration: { scope: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

const sw = self as unknown as WorkerScope;

sw.addEventListener('install', (e) => e.waitUntil(sw.skipWaiting()));

sw.addEventListener('activate', (e) => {
  e.waitUntil(deleteCaches(caches, ASSET_CACHE).then(() => sw.clients.claim()));
});

// `?sw=0` sends 'off' before unregistering: pages this worker controls keep
// fetching through it until they go away, and it must not refill the cache.
let off = false;

sw.addEventListener('message', (e) => {
  if (e.data !== 'off') return;
  off = true;
  e.waitUntil(deleteCaches(caches));
});

sw.addEventListener('fetch', (e) => {
  if (off || !isHashedAsset(e.request, sw.registration.scope)) return;
  e.respondWith(
    caches
      .open(ASSET_CACHE)
      .then((cache) => respond(e.request, cache, fetch, (work) => e.waitUntil(work)))
      .catch(() => fetch(e.request)),
  );
});
