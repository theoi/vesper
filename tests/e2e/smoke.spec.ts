import { expect, test } from '@playwright/test';

test('home page loads @smoke', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle(/Vesper/);
  await expect(page.locator('#app')).not.toBeEmpty();
});

test('the game UI is the default, and ?ui=shell is the fallback @smoke', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [url, ui] of [
    ['./', 'v2'],
    ['./?ui=v2', 'v2'],
    ['./?ui=shell', 'shell'],
  ] as const) {
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('data-ui', ui);
    await expect(page.getByTestId('screen-home')).toBeVisible();
  }
  expect(errors).toEqual([]);
});
