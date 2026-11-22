// The query report's config, which the Query report workflow and a contributor run from a package's
// folder, so its paths are the package's. A plain object: vitest resolves from the packages, not from here.
export default {
  test: {
    // A database that fails or hangs writes no report, so the run stops there.
    bail: 1,
    globalSetup: ['test/support/start-servers.ts'],
    include: ['test/query-report.ts'],
    testTimeout: 5 * 60_000
  }
}
