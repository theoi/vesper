import { expect, test } from '@playwright/test';
import { appUrl, closeAll, openPlayer } from './support/harness.ts';

// The service worker keeps hashed build files (code, images, sounds) so a
// reload or a later visit doesn't wait on GitHub Pages' ten-minute cache.

const cachedPaths = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const cache = await caches.open('vesper-assets-v1');
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });

test('a service worker caches hashed files and serves them on reload @smoke', async ({
  browser,
}) => {
  const me = await openPlayer(browser, 'Solo');
  try {
    await me.page.goto(appUrl());
    await me.page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // The first load ran before the worker existed; this one goes through it.
    await me.page.reload();
    await expect(me.page.getByTestId('screen-home')).toBeVisible();
    expect(await me.page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect
      .poll(async () => (await cachedPaths(me.page)).join('\n'))
      .toMatch(/\/vesper\/assets\/main-[\w-]+\.js/);

    const served: { path: string; fromWorker: boolean }[] = [];
    me.page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith('/vesper/')) served.push({ path, fromWorker: r.fromServiceWorker() });
    });
    await me.page.reload();
    await expect(me.page.getByTestId('screen-home')).toBeVisible();
    const assets = served.filter((s) => s.path.startsWith('/vesper/assets/'));
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.filter((s) => !s.fromWorker)).toEqual([]);
    // Pages themselves always come from the network.
    expect(served.find((s) => s.path === '/vesper/')?.fromWorker).toBe(false);

    // ?sw=0 removes the worker and its cache.
    await me.page.goto(appUrl({ sw: '0' }));
    await expect
      .poll(() =>
        me.page.evaluate(async () => ({
          workers: (await navigator.serviceWorker.getRegistrations()).length,
          caches: (await caches.keys()).length,
        })),
      )
      .toEqual({ workers: 0, caches: 0 });
    expect(me.errors).toEqual([]);
  } finally {
    await closeAll([me]);
  }
});
