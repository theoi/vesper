import { expect, test } from '@playwright/test';
import { auditClientMessages } from '../support/leak-audit.ts';
import {
  allGameSecrets,
  closeAll,
  hostRoom,
  joinRoom,
  keepFinishedGames,
  logLines,
  messagesByGame,
  openPlayer,
  received,
  snapshot,
  you,
  type Player,
} from './support/harness.ts';

// Two games back to back in one room over real WebRTC: the host returns
// everyone to the lobby and deals again; friends never reconnect.
//   E2E_BASE_URL=https://theoi.github.io/vesper/ npx playwright test --grep @online rematch

test.describe('rematch @online', () => {
  let players: Player[] = [];
  test.afterEach(async () => {
    await closeAll(players);
    players = [];
  });

  test('the host plays a second game in the same room with the same friends and bots', async ({
    browser,
  }) => {
    test.setTimeout(20 * 60_000);
    const host = await openPlayer(browser, 'Hana');
    const ari = await openPlayer(browser, 'Ari');
    const bo = await openPlayer(browser, 'Bo');
    players = [host, ari, bo];
    const friends = [ari, bo];

    const code = await hostRoom(host);
    for (const f of friends) await joinRoom(f, code);
    await host.page.getByTestId('fill-count').selectOption('7');
    await host.page.getByTestId('fill-bots').click();
    await host.page.getByTestId('pace').selectOption('fast');
    for (const p of players) {
      await expect(p.page.getByTestId('seats').locator('li')).toHaveCount(7);
      await expect(p.page.getByTestId('pace')).toHaveValue('fast');
    }
    const seats = (await snapshot(host))!.lobby!.seats.map((s) => s.id);
    const seatOf = new Map<Player, string>();
    for (const f of friends) seatOf.set(f, await you(f));

    await keepFinishedGames(host);
    const t0 = Date.now();
    const durations: number[] = [];
    for (const round of [1, 2]) {
      const started = Date.now();
      await host.page.getByTestId('start').click();
      for (const p of players) {
        await expect(p.page.getByTestId('screen-game')).toBeVisible({ timeout: 20_000 });
        await expect(p.page.getByTestId('you-role')).not.toBeEmpty();
      }
      for (const f of friends) {
        const s = await snapshot(f);
        expect(s?.lobby?.round).toBe(round);
        expect(s?.view?.result).toBeNull();
        // A fresh log: nothing from the last game carries over.
        expect((await logLines(f)).join('\n')).not.toContain('Game over');
      }

      await expect(ari.page.getByTestId('phase')).toContainText('Discussion', { timeout: 20_000 });
      const line = `Game ${round}, good evening.`;
      await ari.page.getByTestId('chat-input').fill(line);
      await ari.page.getByTestId('chat-send').click();
      for (const p of [host, bo]) {
        await expect.poll(async () => (await logLines(p)).join('\n')).toContain(`Ari: ${line}`);
      }

      for (const p of players) {
        await expect(p.page.getByTestId('result')).toBeVisible({ timeout: 8 * 60_000 });
      }
      durations.push(Date.now() - started);
      await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
      for (const f of friends) await expect(f.page.getByTestId('back-to-lobby')).toBeHidden();

      if (round === 1) {
        await host.page.getByTestId('back-to-lobby').click();
        for (const p of players) {
          await expect(p.page.getByTestId('screen-lobby')).toBeVisible({ timeout: 20_000 });
          await expect(p.page.getByTestId('seats').locator('li')).toHaveCount(7);
          await expect(p.page.getByTestId('pace')).toHaveValue('fast');
        }
        expect((await snapshot(host))!.lobby!.seats.map((s) => s.id)).toEqual(seats);
        for (const f of friends) {
          expect(await you(f)).toBe(seatOf.get(f));
          expect((await snapshot(f))?.view).toBeNull();
        }
      }
    }

    // Each game's messages pass the hidden-information audit against that game's
    // log. Friends' messages are read first: the host's logs then cover them all.
    const inbox = new Map<Player, Awaited<ReturnType<typeof received>>>();
    for (const f of friends) inbox.set(f, await received(f));
    const games = await allGameSecrets(host);
    expect(games).toHaveLength(2);
    const summary: Record<string, unknown> = {
      transport: process.env.NET ?? 'default',
      totalMs: Date.now() - t0,
      gameMs: durations,
      results: games.map((g) => g.log.find((e) => e.type === 'gameOver')),
    };
    for (const f of friends) {
      const all = inbox.get(f)!;
      expect(all.some((m) => m.t === 'closed')).toBe(false);
      const byGame = messagesByGame(all);
      const counts: number[] = [];
      for (const [round, messages] of byGame) {
        const game = round === 0 ? { log: [], tokens: games[0]!.tokens } : games[round - 1];
        expect(game, `round ${round}`).toBeDefined();
        if (round > 0) expect(messages.filter((m) => m.t === 'view').length).toBeGreaterThan(5);
        const problems = auditClientMessages({
          playerId: seatOf.get(f)!,
          messages,
          hostLog: game!.log,
          tokens: game!.tokens,
        });
        expect(problems, `${f.name} round ${round}`).toEqual([]);
        if (round > 0) counts.push(messages.length);
      }
      expect(counts).toHaveLength(2);
      summary[f.name] = { messages: counts, welcomes: all.filter((m) => m.t === 'welcome').length };
    }
    console.log(`E2E-REMATCH ${JSON.stringify(summary)}`);
    for (const p of players) expect(p.errors).toEqual([]);
  });
});
