import { defineConfig } from 'vitest/config'

// The tests of the plugin's config and of the rules a redirect is built from need no database, so
// only the other tests wait for the database servers to start.
const WITHOUT_DATABASE = [
  'test/config.test.ts',
  'test/destination.test.ts',
  'test/path.test.ts',
  'test/query-string.test.ts',
  'test/regex.test.ts'
]

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { include: WITHOUT_DATABASE, name: 'rules' } },
      {
        extends: true,
        test: {
          exclude: WITHOUT_DATABASE,
          globalSetup: ['test/support/start-servers.ts'],
          hookTimeout: 60_000,
          include: ['test/**/*.test.ts'],
          name: 'databases',
          testTimeout: 60_000
        }
      }
    ]
  }
})
