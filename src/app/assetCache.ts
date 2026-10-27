/**
 * Cache-first handling for Vite's hashed build files (`<base>assets/*`). Their
 * names change whenever their content does, so a cached copy never goes
 * stale. GitHub Pages sends `max-age=600` for everything, so without this a
 * visit or reload after ten minutes revalidates every image and sound.
 * Used by the service worker in `sw.ts`; kept free of worker globals so it
 * can be tested in Node.
 */

export const ASSET_CACHE = 'vesper-assets-v1';
/** Roughly two builds' worth of files; the oldest go first. */
export const MAX_ENTRIES = 600;

/** The parts of the Cache API this module uses. */
export interface AssetCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  keys(): Promise<readonly { url: string }[]>;
  delete(url: string): Promise<boolean>;
}

export type Fetch = (request: Request) => Promise<Response>;

/**
 * True for whole-file GETs of hashed build files under the app's base path.
 * Range requests (media elements) are left to the network.
 */
export function isHashedAsset(request: Request, scope: string): boolean {
  if (request.method !== 'GET' || request.headers.has('range')) return false;
  const url = new URL(request.url);
  const base = new URL('assets/', scope);
  return url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.search;
}

/**
 * Answer from the cache when the file is there, otherwise from the network,
 * keeping a copy. `background` receives the work that may finish after the
 * response (the service worker passes it to `waitUntil`).
 */
export async function respond(
  request: Request,
  cache: AssetCache,
  fetchFn: Fetch,
  background: (work: Promise<unknown>) => void = () => undefined,
): Promise<Response> {
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetchFn(request);
  if (response.status === 200 && (response.type === 'basic' || response.type === 'default')) {
    background(store(request.url, response.clone(), cache));
  }
  return response;
}

async function store(url: string, response: Response, cache: AssetCache): Promise<void> {
  try {
    await cache.put(url, response);
    await prune(cache, MAX_ENTRIES);
  } catch {
    // Storage full or blocked: the next request just goes to the network.
  }
}

/** Delete this app's caches (`vesper-*`), except `keep`. */
export async function deleteCaches(
  storage: Pick<CacheStorage, 'keys' | 'delete'>,
  keep?: string,
): Promise<void> {
  for (const name of await storage.keys()) {
    if (name.startsWith('vesper-') && name !== keep) await storage.delete(name);
  }
}

/** Delete the oldest entries beyond `max`. Cache keys come back in insertion order. */
export async function prune(cache: AssetCache, max: number): Promise<number> {
  const keys = await cache.keys();
  const extra = keys.slice(0, Math.max(0, keys.length - max));
  await Promise.all(extra.map((k) => cache.delete(k.url)));
  return extra.length;
}
