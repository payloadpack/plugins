import { defineConfig } from 'vitest/config'

// The config test only builds Payload configs, so it needs no database server, and only the other
// tests wait for them to start.
export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { include: ['test/config.test.ts'], name: 'config' } },
      {
        extends: true,
        test: {
          exclude: ['test/config.test.ts'],
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
