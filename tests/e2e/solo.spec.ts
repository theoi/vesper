import { expect, test } from '@playwright/test';
import { closeAll, hostRoom, openPlayer, snapshot } from './support/harness.ts';

test('solo play starts offline with bots @smoke', async ({ browser }) => {
  const me = await openPlayer(browser, 'Solo');
  try {
    await hostRoom(me, { online: false });
    await expect(me.page.getByTestId('network-status')).toHaveText('Offline (solo)');
    await expect(me.page.getByTestId('seats').locator('li')).toHaveCount(7);
    await me.page.getByTestId('pace').selectOption('fast');
    await me.page.getByTestId('start').click();
    await expect(me.page.getByTestId('screen-game')).toBeVisible();
    await expect(me.page.getByTestId('you-role')).not.toBeEmpty();
    await expect(me.page.getByTestId('players').locator('li[data-player-id]')).toHaveCount(7);
    await expect(me.page.getByTestId('phase')).toContainText('Discussion', { timeout: 15_000 });
    await me.page.getByTestId('chat-input').fill('Is anyone awake?');
    await me.page.getByTestId('chat-send').click();
    await expect(me.page.getByTestId('log')).toContainText('Solo: Is anyone awake?');
    const s = await snapshot(me);
    expect(s?.isHost).toBe(true);
    expect(me.errors).toEqual([]);
  } finally {
    await closeAll([me]);
  }
});
