import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL points the suite at a deployed site, e.g. https://theoi.github.io/vesper/.
// Without it, the suite builds and serves the site locally.
const deployed = process.env.E2E_BASE_URL;
const baseURL = deployed ?? 'http://localhost:4173/vesper/';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: deployed
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
