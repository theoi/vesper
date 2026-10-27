import { expect, test } from '@playwright/test';

test('home page loads @smoke', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle(/Vesper/);
  await expect(page.locator('#app')).not.toBeEmpty();
});
