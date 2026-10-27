import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { closeAll, hostRoom, openPlayer } from './support/harness.ts';

// How busy the v2 UI keeps the host's main thread in a solo game, in default
// headless Chromium. The host's game loop and every friend's updates share
// that thread, so a UI that saturates it slows the game for the whole table.
// Default headless composites in software, like a browser without GPU
// compositing; don't add --use-angle=swiftshader here, it hides that cost.
//   npx playwright test --grep @perf
// PERF_MAX_BUSY_PCT and PERF_MAX_SEQUENCE_PCT override the budgets. Each
// test attaches its numbers as JSON and prints them as E2E-PERF.

/** Resting in the day or at night, which is most of a game. */
const REST_BUDGET_PCT = Number(process.env.PERF_MAX_BUSY_PCT ?? 30);
/** While a sequence plays (a few seconds each). */
const SEQUENCE_BUDGET_PCT = Number(process.env.PERF_MAX_SEQUENCE_PCT ?? 50);
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
      // Keyed by bucket, and by sequence id for the per-sequence breakdown.
      const spent = new Map<string, { wall: number; busy: number }>();
      const add = (key: string, wall: number, busy: number) => {
        const s = spent.get(key) ?? { wall: 0, busy: 0 };
        spent.set(key, { wall: s.wall + wall, busy: s.busy + busy });
      };
      const measured = (key: string) => spent.get(key)?.wall ?? 0;
      // Run through the whole first dawn too: it stages the night's deaths.
      const enough = () =>
        (['day', 'night', 'sequence'] as const).every((k) => measured(k) >= MIN_MS) &&
        measured('dawn') > 0 &&
        state.sequence !== 'dawn';
      const start = Date.now();
      let state = await stageState(me.page);
      let last = await mainThread(cdp);
      while (!enough() && Date.now() - start < DEADLINE_MS) {
        await me.page.waitForTimeout(250);
        const now = await mainThread(cdp);
        const next = await stageState(me.page);
        // Count only intervals that started and ended in the same state.
        if (state.bucket && state.bucket === next.bucket && state.sequence === next.sequence) {
          add(state.bucket, now.at - last.at, now.busy - last.busy);
          if (state.sequence) add(state.sequence, now.at - last.at, now.busy - last.busy);
        }
        state = next;
        last = now;
        if (await me.page.getByTestId('result').isVisible()) break;
      }

      const pct = (key: string) => {
        const s = spent.get(key) ?? { wall: 0, busy: 0 };
        return Math.round((s.busy / Math.max(1, s.wall)) * 1000) / 10;
      };
      const row = (key: string) => ({ busyPct: pct(key), measuredMs: Math.round(measured(key)) });
      const summary = {
        motion,
        budgetPct: { rest: REST_BUDGET_PCT, sequence: SEQUENCE_BUDGET_PCT },
        day: row('day'),
        night: row('night'),
        sequence: row('sequence'),
        bySequence: Object.fromEntries(
          [...spent.keys()]
            .filter((k) => !['day', 'night', 'sequence'].includes(k))
            .map((k) => [k, row(k)]),
        ),
      };
      console.log(`E2E-PERF ${JSON.stringify(summary)}`);
      await testInfo.attach(`perf-${motion}.json`, {
        body: JSON.stringify(summary, null, 1),
        contentType: 'application/json',
      });
      for (const [k, budget] of [
        ['day', REST_BUDGET_PCT],
        ['night', REST_BUDGET_PCT],
        ['sequence', SEQUENCE_BUDGET_PCT],
      ] as const) {
        expect(measured(k), `${k}: not enough time measured`).toBeGreaterThanOrEqual(MIN_MS / 2);
        expect(pct(k), `${k}: main thread busy %`).toBeLessThanOrEqual(budget);
      }
      expect(me.errors).toEqual([]);
    } finally {
      await closeAll([me]);
    }
  });
}
