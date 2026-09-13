import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite for the reference stand.
 *
 * `webServer` boots the whole stand (`npm run dev`: 7 dev servers + the
 * backend) and waits for the shell; with `reuseExistingServer` an already
 * running stand is used as is. Runs headless in Playwright's own Chromium
 * — never the developer's browser.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
