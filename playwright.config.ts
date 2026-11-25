// Browser tests: the built app, served as the site serves it. `pnpm test:e2e`
// (set CHROME to a Chromium/Chrome executable to use your own instead of Playwright's).
import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1100, height: 800 },
    // the offline tests turn it on; elsewhere a cache would only get in the way
    serviceWorkers: 'block',
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
