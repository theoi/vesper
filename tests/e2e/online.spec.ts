import { expect, test } from '@playwright/test';
import type { HostMessage } from '../../src/net/index.ts';
import { auditClientMessages } from '../support/leak-audit.ts';
import {
  appUrl,
  closeAll,
  hostRoom,
  hostSecrets,
  joinByLink,
  joinRoom,
  logLines,
  openPlayer,
  received,
  snapshot,
  you,
  type Player,
} from './support/harness.ts';

// Real WebRTC through public signaling and STUN. Run against the deployed site:
//   E2E_BASE_URL=https://theoi.github.io/vesper/ npx playwright test --grep @online
// Add NET=trystero-nostr to force the fallback transport.

test.describe('online play @online', () => {
  let players: Player[] = [];
  test.afterEach(async () => {
    await closeAll(players);
    players = [];
  });

  test('friends join by link, play a full game, rejoin, and see only their own secrets', async ({
    browser,
  }) => {
    test.setTimeout(10 * 60_000);
    const host = await openPlayer(browser, 'Hana');
    const ari = await openPlayer(browser, 'Ari');
    const bo = await openPlayer(browser, 'Bo');
    players = [host, ari, bo];

    const code = await hostRoom(host);
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    await expect(host.page.getByTestId('room-link')).toHaveValue(new RegExp(`room=${code}`));
    // Ari opens the host's own link, so she lands on the host's UI.
    await joinByLink(ari, await host.page.getByTestId('room-link').inputValue());
    await expect(ari.page.locator('html')).toHaveAttribute(
      'data-ui',
      (await host.page.locator('html').getAttribute('data-ui')) ?? '',
    );
    await joinRoom(bo, code);

    for (const p of players) {
      await expect(p.page.getByTestId('seats').locator('li')).toHaveCount(3);
    }
    await expect(bo.page.getByTestId('seat-1')).toContainText('Ari');

    await host.page.getByTestId('fill-count').selectOption('7');
    await host.page.getByTestId('fill-bots').click();
    await host.page.getByTestId('pace').selectOption('fast');
    for (const p of players) {
      await expect(p.page.getByTestId('seats').locator('li')).toHaveCount(7);
      await expect(p.page.getByTestId('pace')).toHaveValue('fast');
    }
    await host.page.getByTestId('start').click();

    for (const p of players) {
      await expect(p.page.getByTestId('screen-game')).toBeVisible();
      await expect(p.page.getByTestId('you-role')).not.toBeEmpty();
    }

    // Day 1: a line from Ari reaches everyone.
    await expect(ari.page.getByTestId('phase')).toContainText('Discussion', { timeout: 20_000 });
    await ari.page.getByTestId('chat-input').fill('Good evening, all.');
    await ari.page.getByTestId('chat-send').click();
    for (const p of [host, bo]) {
      await expect
        .poll(async () => (await logLines(p)).join('\n'))
        .toContain('Ari: Good evening, all.');
    }

    // Bo reloads mid-game and is back in the same seat with the same role.
    const boSeat = await you(bo);
    const boRole = await bo.page.getByTestId('you-role').getAttribute('data-role');
    const boLogBefore = await received(bo);
    await bo.page.reload();
    await expect(bo.page.getByTestId('screen-game')).toBeVisible({ timeout: 45_000 });
    expect(await you(bo)).toBe(boSeat);
    await expect(bo.page.getByTestId('you-role')).toHaveAttribute('data-role', boRole ?? '');
    await expect
      .poll(async () => (await logLines(bo)).join('\n'))
      .toContain('Ari: Good evening, all.');

    // Play it out.
    for (const p of players) {
      await expect(p.page.getByTestId('result')).toBeVisible({ timeout: 8 * 60_000 });
    }
    await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();

    // Hidden-information audit over every message each friend's browser received.
    // Read the friends first: bots may still chat after the game ends, and the
    // host's log must cover everything the friends hold.
    const inbox = new Map<Player, HostMessage[]>([
      [ari, await received(ari)],
      [bo, [...boLogBefore, ...(await received(bo))]],
    ]);
    const secrets = await hostSecrets(host);
    expect(secrets.log.length).toBeGreaterThan(0);
    const summary: Record<string, unknown> = {
      transport: process.env.NET ?? 'default',
      hostEvents: secrets.log.length,
      result: secrets.log.find((e) => e.type === 'gameOver'),
    };
    for (const [p, messages] of inbox) {
      expect(messages.length).toBeGreaterThan(10);
      const problems = auditClientMessages({
        playerId: await you(p),
        messages,
        hostLog: secrets.log,
        tokens: secrets.tokens,
      });
      expect(problems).toEqual([]);
      summary[p.name] = {
        messages: messages.length,
        views: messages.filter((m) => m.t === 'view').length,
        auditProblems: problems.length,
      };
    }
    console.log(`E2E-SUMMARY ${JSON.stringify(summary)}`);

    // The host closes the tab: friends wait out the reconnect window (the host
    // might be reloading), then get a clear message. A friend whose attempts
    // never got an answer can't tell a closed room from a lost connection, so
    // either ending is right.
    await host.page.close();
    for (const p of [ari, bo]) {
      await expect(p.page.getByTestId('notice')).toHaveAttribute('data-code', /^(hostLeft|lost)$/, {
        timeout: 120_000,
      });
      await expect(p.page.getByTestId('notice')).toContainText('the game has ended');
    }
    for (const p of players) expect(p.errors).toEqual([]);
  });

  test('the host can remove a player, who cannot come back', async ({ browser }) => {
    test.setTimeout(3 * 60_000);
    const host = await openPlayer(browser, 'Hana');
    const ari = await openPlayer(browser, 'Ari');
    players = [host, ari];
    const code = await hostRoom(host);
    await joinRoom(ari, code);
    await expect(host.page.getByTestId('seats').locator('li')).toHaveCount(2);
    await host.page.getByTestId('remove-1').click();
    await expect(ari.page.getByTestId('notice')).toHaveText('The host removed you from this room.');
    await ari.page.getByTestId('go-home').click();
    await ari.page.getByTestId('code-input').fill(code);
    await ari.page.getByTestId('join').click();
    await expect(ari.page.getByTestId('notice')).toHaveText(
      'The host removed you from this room.',
      {
        timeout: 45_000,
      },
    );
    await expect(host.page.getByTestId('seats').locator('li')).toHaveCount(1);
  });

  test('a code nobody is hosting shows a clear error', async ({ browser }) => {
    test.setTimeout(2 * 60_000);
    const ari = await openPlayer(browser, 'Ari');
    players = [ari];
    await joinRoomExpectingError(ari, 'ZZZZZ');
    await expect(ari.page.getByTestId('notice')).toContainText('No game is open with that code', {
      timeout: 60_000,
    });
    const s = await snapshot(ari);
    expect(s?.notice?.code).toBe('roomNotFound');
  });
});

async function joinRoomExpectingError(p: Player, code: string): Promise<void> {
  await p.page.goto(appUrl({ room: code }));
  await p.page.getByTestId('name-input').fill(p.name);
  await p.page.getByTestId('join').click();
}
