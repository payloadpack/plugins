// A shared runner can pause any run for a millisecond or more, so a promise of speed is held by the
// fastest of several runs: one pause slows one run, not every one.
const RUNS = 5

/** The milliseconds the fastest of several runs of the work took. */
export async function measureFastestRun(work: () => unknown) {
  let fastestMs = Infinity
  for (let run = 0; run < RUNS; run++) {
    const startedAt = performance.now()
    await work()
    fastestMs = Math.min(fastestMs, performance.now() - startedAt)
  }
  return fastestMs
}
