import { defineConfig, devices } from '@playwright/test'

import type { DemoMetadata } from './tests/demo'

const TEST_TIMEOUT_MS = 60_000
const EXPECT_TIMEOUT_MS = 20_000

// Each demo runs on a server and a fresh database of its own, which the demo seeds on its first
// request. The ports sit beside the dev server on 3030, skipping 3031, which macOS keeps for
// Remote Apple Events.
const DEMOS = [
  { localized: false, name: 'without localization', port: 3032 },
  { localized: true, name: 'with localization', port: 3033 }
]

export default defineConfig({
  // A save on a busy machine can take longer than Playwright's five seconds, and the path it shows
  // comes with the save's answer. A path that never comes still fails, only later.
  expect: { timeout: EXPECT_TIMEOUT_MS },
  fullyParallel: true,
  projects: DEMOS.flatMap(({ localized, name, port }) => {
    const metadata: DemoMetadata = { authFile: `tests/.auth/demo-${port}.json`, localized }
    const use = { baseURL: `http://localhost:${port}` }
    return [
      { metadata, name: `setup ${name}`, testMatch: /auth\.setup\.ts/, use },
      {
        dependencies: [`setup ${name}`],
        grepInvert: localized ? undefined : /@localized/,
        metadata,
        name,
        use: { ...use, storageState: metadata.authFile }
      }
    ]
  }),
  reporter: 'list',
  testDir: './tests',
  timeout: TEST_TIMEOUT_MS,
  use: {
    ...devices['Desktop Chrome'],
    trace: process.env.CI ? { mode: 'retain-on-failure', screenshots: false } : 'off',
    viewport: { height: 900, width: 1440 }
  },
  // Playwright starts the servers in order and waits for each, so the first one builds for both:
  // DEMO_LOCALIZED is read when the server starts, not when it builds.
  webServer: DEMOS.map(({ localized, port }, index) => ({
    command: `${index === 0 ? 'bun run build && ' : ''}bun run start --keepAliveTimeout ${TEST_TIMEOUT_MS}`,
    env: { DEMO_LOCALIZED: String(localized), DEMO_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 300_000,
    url: `http://localhost:${port}/admin/login`
  }))
})
