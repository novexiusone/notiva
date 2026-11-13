import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run in a real browser against the frontend with the fake
 * backend. WebKit is the engine Tauri uses on macOS.
 */
// Worktrees that are tested side by side each set their own E2E_PORT. A chosen
// port never reuses a running server, because that could be another worktree's.
const chosenPort = process.env.E2E_PORT;
const port = Number(chosenPort ?? 1430);
const url = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: url,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }],
  webServer: {
    command: `VITE_FAKE_BACKEND=1 pnpm exec vite --port ${port} --strictPort`,
    url,
    reuseExistingServer: !process.env.CI && !chosenPort,
  },
});
