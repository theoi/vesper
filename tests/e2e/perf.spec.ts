import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { closeAll, hostRoom, openPlayer } from './support/harness.ts';

// How busy the v2 UI keeps the host's main thread in a solo game, in default
// headless Chromium. The host's game loop and every friend's updates share
// that thread, so a UI that saturates it slows the game for the whole table.
// Default headless composites in software, like a browser without GPU
// compositing; don't add --use-angle=swiftshader here, it hides that cost.
//   npx playwright test --grep @perf
// PERF_MAX_BUSY_PCT overrides the budget. Results land in test-results/perf-*.json.

const BUDGET_PCT = Number(process.env.PERF_MAX_BUSY_PCT ?? 30);
/** Each state needs this much measured time before the game may stop. */
const MIN_MS = 4000;
const DEADLINE_MS = 150_000;

type Bucket = 'day' | 'night' | 'sequence';

/** What the stage is doing: a sequence playing (and which), or the phase it rests in. */
async function stageState(page: Page): Promise<{ bucket: Bucket | null; sequence?: string }> {
  const s = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-testid="stage"]');
    return stage ? { phase: stage.dataset.phase, sequence: stage.dataset.sequence } : null;
  });
  if (!s) return { bucket: null };
  if (s.sequence) return { bucket: 'sequence', sequence: s.sequence };
  if (s.phase === 'discussion') return { bucket: 'day' };
  if (s.phase === 'night') return { bucket: 'night' };
  return { bucket: null };
}

async function mainThread(cdp: CDPSession): Promise<{ at: number; busy: number }> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { at: get('Timestamp') * 1000, busy: get('TaskDuration') * 1000 };
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`the v2 UI leaves the host's main thread room to run the game (motion: ${motion}) @perf`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(DEADLINE_MS + 60_000);
    const me = await openPlayer(browser, 'Solo');
    try {
      await me.page.emulateMedia({ reducedMotion: motion });
      await hostRoom(me, { online: false, params: { ui: 'v2' } });
      await expect(me.page.locator('html')).toHaveAttribute('data-ui', 'v2');
      await me.page.getByTestId('pace').selectOption('fast');
      await me.page.getByTestId('start').click();
      await expect(me.page.getByTestId('screen-game')).toBeVisible();

      const cdp = await me.page.context().newCDPSession(me.page);
      await cdp.send('Performance.enable');
      const spent: Record<Bucket, { wall: number; busy: number }> = {
        day: { wall: 0, busy: 0 },
        night: { wall: 0, busy: 0 },
        sequence: { wall: 0, busy: 0 },
      };
      const enough = () => Object.values(spent).every((b) => b.wall >= MIN_MS);
      const start = Date.now();
      const sequences = new Set<string>();
      let state = await stageState(me.page);
      let last = await mainThread(cdp);
      while (!enough() && Date.now() - start < DEADLINE_MS) {
        await me.page.waitForTimeout(250);
        const now = await mainThread(cdp);
        const next = await stageState(me.page);
        if (next.sequence) sequences.add(next.sequence);
        // Count only intervals that started and ended in the same state.
        if (state.bucket && state.bucket === next.bucket && state.sequence === next.sequence) {
          spent[state.bucket].wall += now.at - last.at;
          spent[state.bucket].busy += now.busy - last.busy;
        }
        state = next;
        last = now;
        if (await me.page.getByTestId('result').isVisible()) break;
      }

      const report = Object.fromEntries(
        Object.entries(spent).map(([k, b]) => [
          k,
          {
            busyPct: Math.round((b.busy / Math.max(1, b.wall)) * 1000) / 10,
            measuredMs: Math.round(b.wall),
          },
        ]),
      ) as Record<Bucket, { busyPct: number; measuredMs: number }>;
      const summary = { motion, budgetPct: BUDGET_PCT, ...report, sequences: [...sequences] };
      console.log(`E2E-PERF ${JSON.stringify(summary)}`);
      await testInfo.attach(`perf-${motion}.json`, {
        body: JSON.stringify(summary, null, 1),
        contentType: 'application/json',
      });
      for (const [k, r] of Object.entries(report)) {
        expect(r.measuredMs, `${k}: not enough time measured`).toBeGreaterThanOrEqual(MIN_MS / 2);
        expect(r.busyPct, `${k}: main thread busy %`).toBeLessThanOrEqual(BUDGET_PCT);
      }
      expect(me.errors).toEqual([]);
    } finally {
      await closeAll([me]);
    }
  });
}
