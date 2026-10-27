import { expect, test } from '@playwright/test';
import { auditClientMessages } from '../support/leak-audit.ts';
import {
  closeAll,
  hostRoom,
  hostSecrets,
  joinRoom,
  logLines,
  openPlayer,
  received,
  snapshot,
  you,
  type Player,
} from './support/harness.ts';

// The host's page is the game. A reload saves the room in the tab
// (sessionStorage) and resumes it; friends reconnect on their own.

function hostGame(p: Player) {
  return p.page.evaluate(() => {
    const c = window.__vesper!;
    const game = c.host!.debugState().game!;
    return {
      code: c.getState().session!.code,
      seq: game.seq,
      roles: game.players.map((x) => x.role),
    };
  });
}

test('a solo game survives a reload @smoke', async ({ browser }) => {
  const me = await openPlayer(browser, 'Solo');
  try {
    await hostRoom(me, { online: false });
    await me.page.getByTestId('pace').selectOption('fast');
    await me.page.getByTestId('start').click();
    await expect(me.page.getByTestId('phase')).toContainText('Discussion', { timeout: 15_000 });
    await me.page.getByTestId('chat-input').fill('Remember me?');
    await me.page.getByTestId('chat-send').click();
    await expect(me.page.getByTestId('log')).toContainText('Solo: Remember me?');
    const role = await me.page.getByTestId('you-role').getAttribute('data-role');
    const before = await hostGame(me);

    await me.page.reload();
    await expect(me.page.getByTestId('screen-game')).toBeVisible();
    await expect(me.page.getByTestId('you-role')).toHaveAttribute('data-role', role ?? '');
    await expect(me.page.getByTestId('log')).toContainText('Solo: Remember me?');
    const after = await hostGame(me);
    expect(after.code).toBe(before.code);
    expect(after.roles).toEqual(before.roles);
    expect(after.seq).toBeGreaterThanOrEqual(before.seq);
    // The game carries on.
    await expect
      .poll(async () => (await hostGame(me)).seq, { timeout: 30_000 })
      .toBeGreaterThan(after.seq);

    // Leaving on purpose ends it: the next reload starts fresh.
    await me.page.getByTestId('leave').click();
    await me.page.reload();
    await expect(me.page.getByTestId('screen-home')).toBeVisible();
    expect(me.errors).toEqual([]);
  } finally {
    await closeAll([me]);
  }
});

test.describe('host reload @online', () => {
  let players: Player[] = [];
  test.afterEach(async () => {
    await closeAll(players);
    players = [];
  });

  test('friends keep their seats and the game goes on when the host reloads', async ({
    browser,
  }) => {
    test.setTimeout(4 * 60_000);
    const host = await openPlayer(browser, 'Hana');
    const ari = await openPlayer(browser, 'Ari');
    players = [host, ari];
    const code = await hostRoom(host);
    await joinRoom(ari, code);
    await host.page.getByTestId('fill-count').selectOption('7');
    await host.page.getByTestId('fill-bots').click();
    await host.page.getByTestId('pace').selectOption('fast');
    await host.page.getByTestId('start').click();
    await expect(ari.page.getByTestId('phase')).toContainText('Discussion', { timeout: 20_000 });
    await ari.page.getByTestId('chat-input').fill('Before the reload.');
    await ari.page.getByTestId('chat-send').click();
    await expect
      .poll(async () => (await logLines(host)).join('\n'))
      .toContain('Ari: Before the reload.');

    const ariSeat = await you(ari);
    const ariRole = await ari.page.getByTestId('you-role').getAttribute('data-role');
    const hostRole = await host.page.getByTestId('you-role').getAttribute('data-role');
    const before = await hostGame(host);
    await ari.page.evaluate(() => {
      const w = window as unknown as { __statuses: string[] };
      w.__statuses = [];
      window.__vesper!.subscribe((s) => {
        const st = s.session?.status;
        if (st && w.__statuses.at(-1) !== st) w.__statuses.push(st);
      });
    });

    const t0 = Date.now();
    await host.page.reload();
    await expect(host.page.getByTestId('screen-game')).toBeVisible();
    await expect(host.page.getByTestId('you-role')).toHaveAttribute('data-role', hostRole ?? '');
    await expect
      .poll(async () => (await snapshot(host))?.network.state, { timeout: 60_000 })
      .toBe('open');
    const hostBackMs = Date.now() - t0;
    const after = await hostGame(host);
    expect(after.code).toBe(code);
    expect(after.roles).toEqual(before.roles);

    const statuses = () =>
      ari.page.evaluate(() => (window as unknown as { __statuses: string[] }).__statuses);
    await expect
      .poll(async () => (await statuses()).join(','), { timeout: 60_000 })
      .toMatch(/reconnecting,(playing|ended)$/);
    const friendBackMs = Date.now() - t0;
    expect(await you(ari)).toBe(ariSeat);
    await expect(ari.page.getByTestId('you-role')).toHaveAttribute('data-role', ariRole ?? '');
    await expect
      .poll(
        async () => (await snapshot(host))?.lobby?.seats.find((s) => s.id === ariSeat)?.connected,
      )
      .toBe(true);

    // An intent from Ari reaches the resumed host and gets an answer (accepted,
    // or rejected if Ari has died since).
    const answered = await ari.page.evaluate(async () => {
      const c = window.__vesper!;
      const id = c.setWill('Written after the host came back.');
      for (let i = 0; i < 100; i++) {
        const s = c.getState().session!;
        if (s.view?.you.will === 'Written after the host came back.') return 'accepted';
        if (s.lastRejection?.id === id) return 'rejected';
        await new Promise((r) => setTimeout(r, 100));
      }
      return 'no answer';
    });
    expect(answered).not.toBe('no answer');

    const messages = await received(ari);
    expect(messages.some((m) => m.t === 'closed')).toBe(false);
    const secrets = await hostSecrets(host);
    const problems = auditClientMessages({
      playerId: ariSeat,
      messages,
      hostLog: secrets.log,
      tokens: secrets.tokens,
    });
    expect(problems).toEqual([]);
    console.log(
      `E2E-RESUME ${JSON.stringify({ transport: process.env.NET ?? 'default', hostBackMs, friendBackMs, answered, statuses: await statuses() })}`,
    );
    for (const p of players) expect(p.errors).toEqual([]);
  });
});
