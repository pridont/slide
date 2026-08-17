import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end, against a real build served as static files — the thing that
 * ships, not the dev server.
 *
 * Chromium only, on purpose: what these tests are for is the behaviour no
 * other engine has yet (cross-document view transitions, prerendering) and the
 * parts that are easier to get wrong than to reason about (two windows on one
 * channel). The graceful degradation elsewhere is a `pnpm build` and a look.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4178',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm e2e:serve',
    url: 'http://localhost:4178/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
