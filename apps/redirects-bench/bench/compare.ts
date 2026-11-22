import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { findRedirect, REDIRECTS_SLUG } from '@payloadpack/redirects'
import { rmSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPayload, type Payload } from 'payload'

import { buildBenchConfig, DATABASES, type Database } from '../src/build-config.ts'
import { VIEWED_PATHS } from '../src/viewed-paths.ts'
import { readDatabaseVersion, startDatabase, waitForMongodbIndexes } from './databases.ts'
import {
  buildOfficialRedirectsPlugin,
  findAllOfficialRedirects,
  findOfficialRedirect,
  getCachedOfficialRedirect,
  getNextCacheEntryLength,
  NEXT_CACHE_LIMIT,
  OFFICIAL_REDIRECTS_SLUG,
  pickOfficialRedirect
} from './official-redirects.ts'
import {
  buildMarkdownTable,
  checkReadmeTable,
  DATABASE_LABELS,
  formatCount,
  formatTiming,
  FULL_RUN_COUNTS,
  isFullRun,
  readMachine,
  readNarrowing,
  readVersion,
  roundToHundredths,
  summarize,
  writeReadmeTable,
  type Timing
} from './report.ts'
import { buildComparisonReadmeTable, COMPARISON_README_TABLE } from './comparison-readme.ts'
import { createComparisonSeeder } from './seed.ts'
import { holdStop } from './stops.ts'

// As the speed bench times page views: untimed runs first, so V8 has compiled what a check runs.
const WARM_UP_RUNS = 500
const TIMED_RUNS = 2_000
// A slow case, such as every redirect read at 100,000, gets the runs that fit in about a minute,
// estimated from its warm-up, and never fewer than 100, so its p95 still stands on several runs.
const TIMED_TIME = 60_000
const FEWEST_TIMED_RUNS = 100
// Its warm-up stops once it has taken a quarter of that, after at least a few runs.
const WARM_UP_TIME = TIMED_TIME / 4
const FEWEST_WARM_UP_RUNS = 5

const REPORT_FILE = fileURLToPath(new URL('../../docs/src/data/redirects-comparison.json', import.meta.url))

// A page view no redirect covers, as the speed bench times them.
const PATH_NO_REDIRECT_COVERS = VIEWED_PATHS[0]!

type PathTimings = { pathARedirectCovers: RunTiming; pathNoRedirectCovers: RunTiming }

type RunTiming = Timing & { runs: number; warmUpRuns: number }

type ComparisonCase = {
  database: Database
  redirects: number
  // The path a redirect covers, from the middle of the list the template reads, so its scan stops
  // halfway, and where in that list it is.
  pathARedirectCovers: { path: string; position: number }
  pathNoRedirectCovers: string
  // The list the template caches, as JSON.stringify gives it, and what Next checks against its limit.
  cachedList: { bytes: number; bytesPerRedirect: number; nextCacheEntryLength: number; overNextCacheLimit: boolean }
  ours: PathTimings
  theirsListNotCached: PathTimings
  // Only what a read of the cached list costs. Over Next's limit, Next never caches the list, so this
  // case can't happen in Next and every check costs what theirsListNotCached does.
  theirsListCached: PathTimings & { happensInNext: boolean }
}

async function timeRuns(check: () => unknown): Promise<RunTiming> {
  const warmUpDurations: number[] = []
  const warmUpStartedAt = performance.now()
  while (
    warmUpDurations.length < WARM_UP_RUNS &&
    (warmUpDurations.length < FEWEST_WARM_UP_RUNS || performance.now() - warmUpStartedAt < WARM_UP_TIME)
  ) {
    const startedAt = performance.now()
    await check()
    warmUpDurations.push(performance.now() - startedAt)
  }
  // Estimated from the second half of the warm-up, once V8 has compiled what the check runs.
  const runTime = summarize(warmUpDurations.slice(Math.floor(warmUpDurations.length / 2))).median
  const runs = Math.min(TIMED_RUNS, Math.max(FEWEST_TIMED_RUNS, Math.floor(TIMED_TIME / runTime)))
  const durations: number[] = []
  for (let run = 0; run < runs; run++) {
    const startedAt = performance.now()
    await check()
    durations.push(performance.now() - startedAt)
  }
  return { ...summarize(durations), runs, warmUpRuns: warmUpDurations.length }
}

// The path a redirect covers first, then the one no redirect covers.
async function timePaths(
  label: string,
  paths: { covered: string; notCovered: string },
  check: (path: string) => unknown
): Promise<PathTimings> {
  console.log(`  ${label}`)
  const pathARedirectCovers = await timeRuns(() => check(paths.covered))
  const pathNoRedirectCovers = await timeRuns(() => check(paths.notCovered))
  return { pathARedirectCovers, pathNoRedirectCovers }
}

// Before any timing: both sides find the redirect that covers the one path, and none for the other.
async function checkAnswers(payload: Payload, covered: { path: string; url: string }) {
  const listed = await findAllOfficialRedirects(payload)
  const answers = {
    ours: [
      (await findRedirect({ path: covered.path, payload })).foundRedirect?.destination,
      (await findRedirect({ path: PATH_NO_REDIRECT_COVERS, payload })).foundRedirect?.destination
    ],
    theirs: [pickOfficialRedirect(listed, covered.path)?.to?.url, pickOfficialRedirect(listed, PATH_NO_REDIRECT_COVERS)?.to?.url]
  }
  for (const [side, [coveredAnswer, notCoveredAnswer]] of Object.entries(answers)) {
    if (coveredAnswer !== covered.url || notCoveredAnswer !== undefined) {
      throw new Error(
        `${side} answered ${covered.path} with ${String(coveredAnswer)}, not ${covered.url}, and ${PATH_NO_REDIRECT_COVERS} with ${String(notCoveredAnswer)}, not none`
      )
    }
  }
}

async function compareAt(payload: Payload, database: Database, redirects: number): Promise<ComparisonCase> {
  const list = await findAllOfficialRedirects(payload)
  if (list.length !== redirects) throw new Error(`The template read ${list.length} redirects, not ${redirects}`)
  const position = Math.floor(list.length / 2)
  const coveredRedirect = list[position]!
  const covered = { path: coveredRedirect.from, url: coveredRedirect.to!.url! }
  await checkAnswers(payload, covered)
  // What unstable_cache stores for the template's list.
  const cachedList = JSON.stringify(list)
  const nextCacheEntryLength = getNextCacheEntryLength(cachedList)
  const happensInNext = nextCacheEntryLength <= NEXT_CACHE_LIMIT
  const paths = { covered: covered.path, notCovered: PATH_NO_REDIRECT_COVERS }

  // Ours first and the full list last, so the garbage a list of every redirect leaves lands in no
  // other case's timing.
  const ours = await timePaths('Ours', paths, (path) => findRedirect({ path, payload }))
  const theirsListCached = await timePaths('Theirs, list cached', paths, (path) => getCachedOfficialRedirect(cachedList, path))
  const theirsListNotCached = await timePaths('Theirs, list not cached', paths, (path) => findOfficialRedirect(payload, path))
  const bytes = Buffer.byteLength(cachedList)
  return {
    database,
    redirects,
    pathARedirectCovers: { path: covered.path, position },
    pathNoRedirectCovers: PATH_NO_REDIRECT_COVERS,
    cachedList: {
      bytes,
      bytesPerRedirect: Math.round(bytes / redirects),
      nextCacheEntryLength,
      overNextCacheLimit: !happensInNext
    },
    ours,
    theirsListNotCached,
    theirsListCached: { ...theirsListCached, happensInNext }
  }
}

async function compareDatabase(database: Database, directory: string, counts: number[], cases: ComparisonCase[]) {
  const stops: (() => Promise<unknown>)[] = []
  try {
    const startedDatabase = await startDatabase(database, directory)
    stops.push(holdStop(startedDatabase.stop))
    const payload = await getPayload({
      config: buildBenchConfig({
        createSchema: true,
        database,
        plugins: [buildOfficialRedirectsPlugin()],
        url: startedDatabase.url
      }),
      key: `compare-${database}`
    })
    // Payload's Postgres adapter leaves its pool open on destroy, and Postgres stopping under a busy
    // pool ends the run with an error, so the pool ends here first.
    stops.push(
      holdStop(async () => {
        await payload.destroy()
        if (database === 'postgres') await (payload.db as unknown as PostgresAdapter).pool.end()
      })
    )
    if (database === 'mongodb') {
      await waitForMongodbIndexes(payload, { [OFFICIAL_REDIRECTS_SLUG]: ['from_1'], [REDIRECTS_SLUG]: ['lookupPath_1'] })
    }
    const version = await readDatabaseVersion(database, payload)
    const seeder = createComparisonSeeder(payload)
    for (const count of counts) {
      console.log(`Seeding ${database} to ${formatCount(count)} redirects on each side`)
      await seeder.growTo(count)
      console.log(`Timing ${database} at ${formatCount(count)} redirects`)
      cases.push(await compareAt(payload, database, count))
    }
    return { database, version }
  } finally {
    for (const stop of stops.reverse()) await stop()
  }
}

const formatBytes = (bytes: number) => `${(bytes / 1024 ** 2).toLocaleString('en', { maximumFractionDigits: 2 })} MB`

function printComparison(cases: ComparisonCase[]) {
  const rows = cases.flatMap((result) =>
    (['pathARedirectCovers', 'pathNoRedirectCovers'] as const).map((path) => [
      DATABASE_LABELS[result.database],
      formatCount(result.redirects),
      path === 'pathARedirectCovers' ? 'Covered' : 'Not covered',
      formatTiming(result.ours[path]),
      formatTiming(result.theirsListNotCached[path]),
      `${formatTiming(result.theirsListCached[path])}${result.theirsListCached.happensInNext ? '' : ', never in Next'}`,
      `${formatBytes(result.cachedList.bytes)}${result.cachedList.overNextCacheLimit ? ', over 2 MB' : ''}`
    ])
  )
  console.log(
    `\nOne check for a redirect, median (p95):\n\n${buildMarkdownTable(
      ['Database', 'Redirects', 'Path', 'Ours', 'Theirs, list not cached', 'Theirs, list cached', 'List'],
      rows
    )}`
  )
}

const roundTiming = ({ median, p95, runs, warmUpRuns }: RunTiming) => ({
  median: roundToHundredths(median),
  p95: roundToHundredths(p95),
  runs,
  warmUpRuns
})

const roundPathTimings = ({ pathARedirectCovers, pathNoRedirectCovers }: PathTimings) => ({
  pathARedirectCovers: roundTiming(pathARedirectCovers),
  pathNoRedirectCovers: roundTiming(pathNoRedirectCovers)
})

const runStartedAt = performance.now()
const narrowing = readNarrowing()
if (isFullRun(narrowing)) await checkReadmeTable(COMPARISON_README_TABLE)
const machine = { ...(await readMachine()), pluginRedirects: await readVersion('@payloadcms/plugin-redirects') }
const directory = await mkdtemp(path.join(tmpdir(), 'redirects-compare-'))
const removeDirectory = holdStop(
  () => rm(directory, { force: true, recursive: true }),
  () => rmSync(directory, { force: true, recursive: true })
)
try {
  const cases: ComparisonCase[] = []
  const databases: { database: Database; version: string }[] = []
  for (const database of narrowing.databases) {
    databases.push(await compareDatabase(database, directory, narrowing.counts, cases))
  }
  printComparison(cases)
  if (isFullRun(narrowing)) {
    const report = {
      ranOn: { date: new Date().toISOString().slice(0, 10), ...machine },
      warmUpRuns: WARM_UP_RUNS,
      timedRuns: TIMED_RUNS,
      fewestTimedRuns: FEWEST_TIMED_RUNS,
      nextCacheLimit: NEXT_CACHE_LIMIT,
      databases,
      cases: cases.map((result) => ({
        ...result,
        ours: roundPathTimings(result.ours),
        theirsListNotCached: roundPathTimings(result.theirsListNotCached),
        theirsListCached: {
          ...roundPathTimings(result.theirsListCached),
          happensInNext: result.theirsListCached.happensInNext
        }
      }))
    }
    // Built first, so numbers that no longer say what the README says stop the run before either file changes.
    const readmeTable = buildComparisonReadmeTable(report.cases)
    await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`)
    await writeReadmeTable(COMPARISON_README_TABLE, readmeTable)
    console.log(`\nWritten to ${REPORT_FILE} and the README.`)
  } else {
    console.log(
      `\nNothing written, because only a run of ${DATABASES.join(', ')} at ${FULL_RUN_COUNTS.map(formatCount).join(', ')} redirects writes its numbers.`
    )
  }
  const seconds = Math.round((performance.now() - runStartedAt) / 1_000)
  console.log(`\nThe run took ${Math.floor(seconds / 60)} min ${seconds % 60} s.`)
} finally {
  await removeDirectory()
}
