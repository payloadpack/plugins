import { defineConfig, devices } from '@playwright/test'

import { AUTH_FILE } from './tests/demo'

const TEST_TIMEOUT_MS = 60_000
const EXPECT_TIMEOUT_MS = 20_000

// The demo runs on a server and a fresh database of its own, which the demo seeds on its first
// request, on a port beside the dev server on 3040.
const PORT = 3042

export default defineConfig({
  // A save on a busy machine can take longer than Playwright's five seconds.
  expect: { timeout: EXPECT_TIMEOUT_MS },
  fullyParallel: true,
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { dependencies: ['setup'], name: 'demo', use: { storageState: AUTH_FILE } }
  ],
  reporter: 'list',
  testDir: './tests',
  timeout: TEST_TIMEOUT_MS,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    trace: process.env.CI ? { mode: 'retain-on-failure', screenshots: false } : 'off',
    viewport: { height: 900, width: 1440 }
  },
  webServer: {
    command: `bun run build && bun run start --keepAliveTimeout ${TEST_TIMEOUT_MS}`,
    env: { DEMO_PORT: String(PORT) },
    timeout: 300_000,
    url: `http://localhost:${PORT}/admin/login`
  }
})
