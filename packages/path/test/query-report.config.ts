import { defineConfig } from 'vitest/config'

// The query report, which the Query report workflow and a contributor run, and the package's own
// config never includes.
export default defineConfig({
  test: {
    globalSetup: ['test/support/start-servers.ts'],
    hookTimeout: 0,
    include: ['test/query-report.ts'],
    testTimeout: 0
  }
})
