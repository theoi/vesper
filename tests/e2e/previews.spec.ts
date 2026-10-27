import { expect, test, type Page } from '@playwright/test';

// Directions whose preview pages are merged. Each must start, play every scene, and make sound.
const SLUGS = ['masque', 'agitprop', 'deadair'];

interface PreviewApi {
  scenes: { id: string }[];
  goto(id: string): void;
  current(): string | null;
  audioCheck(
    bedSeconds?: number,
    stingSeconds?: number,
  ): Promise<{ kind: string; name: string; rmsDb: number; silentFrac: number }[]>;
}

const api = <T>(page: Page, fn: (p: PreviewApi, arg: string) => T | Promise<T>, arg = '') =>
  page.evaluate(
    ([src, a]) => {
      const p = (window as unknown as { __preview: PreviewApi }).__preview;
      return new Function('p', 'a', `return (${src})(p, a)`)(p, a) as T;
    },
    [fn.toString(), arg] as const,
  );

test('previews index lists the three directions @smoke', async ({ page }) => {
  await page.goto('./previews/');
  await expect(page.locator('.panel')).toHaveCount(3);
});

for (const slug of SLUGS) {
  test(`preview ${slug} plays every scene with sound and no errors @smoke`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`./previews/${slug}/?auto=0`);
    await page.locator('.pv-gate').click();
    await expect.poll(() => api(page, (p) => p.current())).toBe('title');

    const ids = await api(page, (p) => p.scenes.map((s) => s.id));
    expect(ids).toEqual(['title', 'role', 'nightfall', 'dawn', 'day', 'trial', 'execution']);
    for (const id of ids) {
      await api(page, (p, a) => p.goto(a), id);
      await expect.poll(() => api(page, (p) => p.current())).toBe(id);
      await page.waitForTimeout(300);
    }

    const audio = await api(page, (p) => p.audioCheck(4, 3));
    for (const a of audio) {
      expect(a.rmsDb, `${a.kind} ${a.name} is silent`).toBeGreaterThan(
        a.kind === 'bed' ? -35 : -45,
      );
      if (a.kind === 'bed') expect(a.silentFrac, `${a.name} has gaps`).toBeLessThan(0.5);
    }
    expect(errors).toEqual([]);
  });
}
