import { ASSET_CACHE, isHashedAsset, respond } from './assetCache.ts';

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
interface WorkerScope {
  registration: { scope: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (e: FetchEvent) => void): void;
}

const sw = self as unknown as WorkerScope;

sw.addEventListener('install', (e) => e.waitUntil(sw.skipWaiting()));

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('vesper-') && name !== ASSET_CACHE) await caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (e) => {
  if (!isHashedAsset(e.request, sw.registration.scope)) return;
  e.respondWith(
    caches
      .open(ASSET_CACHE)
      .then((cache) => respond(e.request, cache, fetch, (work) => e.waitUntil(work)))
      .catch(() => fetch(e.request)),
  );
});
