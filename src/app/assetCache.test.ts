import { describe, expect, it } from 'vitest';
import { isHashedAsset, prune, respond, type AssetCache } from './assetCache.ts';

const SCOPE = 'https://theoi.github.io/vesper/';
const ASSET = `${SCOPE}assets/face-anton-afraid-3fA9c2.webp`;

function memoryCache(): AssetCache & { map: Map<string, Response> } {
  const map = new Map<string, Response>();
  return {
    map,
    match: async (url) => map.get(url)?.clone(),
    put: async (url, res) => void map.set(url, res),
    keys: async () => [...map.keys()].map((url) => ({ url })),
    delete: async (url) => map.delete(url),
  };
}

function network(status = 200) {
  const calls: string[] = [];
  const fetchFn = async (req: Request) => {
    calls.push(req.url);
    return new Response(`body of ${req.url}`, { status });
  };
  return { fetchFn, calls };
}

describe('isHashedAsset', () => {
  it('takes only whole-file GETs of build files under the base path', () => {
    expect(isHashedAsset(new Request(ASSET), SCOPE)).toBe(true);
    expect(isHashedAsset(new Request(`${SCOPE}?room=KX7QM`), SCOPE)).toBe(false);
    expect(isHashedAsset(new Request(`${SCOPE}sw.js`), SCOPE)).toBe(false);
    expect(isHashedAsset(new Request(`${SCOPE}previews/scrim/`), SCOPE)).toBe(false);
    expect(isHashedAsset(new Request(`${ASSET}?v=2`), SCOPE)).toBe(false);
    expect(isHashedAsset(new Request('https://theoi.github.io/other/assets/a.js'), SCOPE)).toBe(
      false,
    );
    expect(isHashedAsset(new Request('https://api.anthropic.com/v1/messages'), SCOPE)).toBe(false);
    expect(isHashedAsset(new Request(ASSET, { method: 'POST', body: 'x' }), SCOPE)).toBe(false);
    expect(isHashedAsset(new Request(ASSET, { headers: { range: 'bytes=0-99' } }), SCOPE)).toBe(
      false,
    );
  });
});

describe('respond', () => {
  it('fetches once, then serves from the cache', async () => {
    const cache = memoryCache();
    const net = network();
    const pending: Promise<unknown>[] = [];
    const first = await respond(new Request(ASSET), cache, net.fetchFn, (w) => pending.push(w));
    expect(await first.text()).toBe(`body of ${ASSET}`);
    await Promise.all(pending);
    const second = await respond(new Request(ASSET), cache, net.fetchFn);
    expect(await second.text()).toBe(`body of ${ASSET}`);
    expect(net.calls).toEqual([ASSET]);
  });

  it('does not keep failed responses', async () => {
    const cache = memoryCache();
    const net = network(404);
    const pending: Promise<unknown>[] = [];
    const res = await respond(new Request(ASSET), cache, net.fetchFn, (w) => pending.push(w));
    expect(res.status).toBe(404);
    await Promise.all(pending);
    expect(cache.map.size).toBe(0);
  });
});

describe('prune', () => {
  it('drops the oldest entries beyond the limit', async () => {
    const cache = memoryCache();
    for (let i = 0; i < 5; i++) await cache.put(`${SCOPE}assets/${i}.webp`, new Response(''));
    expect(await prune(cache, 3)).toBe(2);
    expect([...cache.map.keys()]).toEqual([2, 3, 4].map((i) => `${SCOPE}assets/${i}.webp`));
    expect(await prune(cache, 3)).toBe(0);
  });
});
