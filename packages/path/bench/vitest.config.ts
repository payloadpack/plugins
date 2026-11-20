import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['test/support/start-servers.ts'],
    hookTimeout: 0,
    include: ['bench/benchmark.ts'],
    reporters: ['verbose'],
    silent: false,
    testTimeout: 0
  }
})
