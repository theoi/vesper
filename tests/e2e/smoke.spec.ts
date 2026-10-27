import { expect, test } from '@playwright/test';

test('home page loads @smoke', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle(/Vesper/);
  await expect(page.locator('#app')).not.toBeEmpty();
});

test('the shell is the default UI, and every ?ui= choice shows a home screen @smoke', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const url of ['./', './?ui=shell']) {
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('data-ui', 'shell');
    await expect(page.getByTestId('screen-home')).toBeVisible();
  }
  // The new UI, or the shell if this build has none yet: never a blank page.
  await page.goto('./?ui=v2');
  await expect(page.locator('html')).toHaveAttribute('data-ui', /^(v2|shell)$/);
  await expect(page.getByTestId('screen-home')).toBeVisible();
  expect(errors).toEqual([]);
});
