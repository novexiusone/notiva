import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run in a real browser against the frontend with the fake
 * backend. WebKit is the engine Tauri uses on macOS.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:1430',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }],
  webServer: {
    command: 'pnpm dev:fake',
    url: 'http://localhost:1430',
    reuseExistingServer: !process.env.CI,
  },
});
