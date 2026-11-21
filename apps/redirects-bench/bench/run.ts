import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { SQLiteAdapter } from '@payloadcms/db-sqlite'
import { rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getPayload, type Payload } from 'payload'

import { buildBenchConfig, DATABASES, type Database } from '../src/build-config.ts'
import { VIEWED_PATHS } from '../src/viewed-paths.ts'
import { startDatabase } from './databases.ts'
import { DELAY_EACH_WAY, startRelay, type Relay } from './relay.ts'
import {
  buildGrowthWarnings,
  checkReadme,
  FULL_RUN_COUNTS,
  getMostRedirects,
  printAll,
  readMachine,
  roundToHundredths,
  writeReport,
  type CaseResult,
  type DatabaseResult,
  type Distance,
  type Run,
  type Timing
} from './report.ts'
import { addRegexesWithoutFixedStart, createSeeder, REGEXES_WITHOUT_FIXED_START } from './seed.ts'
import { BUILDS, buildApp, startServer, type ProxyBuild, type Server } from './servers.ts'
import { holdStop } from './stops.ts'

// Untimed pairs first, so both servers have compiled and cached what a page view runs.
const WARM_UP_PAIRS = 500
const TIMED_PAIRS = 2_000
const ROUND_TRIP_QUERIES = { timed: 200, warmUp: 20 }
// A page view from a campaign link carries a query string, which the proxy for query strings checks.
const QUERY = '?utm_source=newsletter&utm_medium=email'

// BENCH_DATABASES=sqlite and BENCH_COUNTS=1000 narrow a run, to check the bench itself.
function readList<T>(name: string, all: T[], parse: (value: string) => T, valid: (value: T) => boolean) {
  const list = process.env[name] ?? ''
  if (list === '') return all
  const values = list.split(',').map(parse)
  if (values.some((value) => !valid(value))) {
    throw new Error(`${name} is ${list}, so give some of ${all.join(',')}, or leave it out for all of them.`)
  }
  return values
}

const RUN: Run = {
  counts: readList('BENCH_COUNTS', FULL_RUN_COUNTS, Number, (count) => Number.isInteger(count) && count >= 1_000).sort(
    (first, second) => first - second
  ),
  databases: readList<Database>(
    'BENCH_DATABASES',
    [...DATABASES],
    (value) => value as Database,
    (value) => DATABASES.includes(value)
  ),
  relayDelayEachWay: DELAY_EACH_WAY,
  timedPairs: TIMED_PAIRS,
  warmUpPairs: WARM_UP_PAIRS
}

const getMedian = (sortedDurations: number[]) => sortedDurations[Math.floor(sortedDurations.length / 2)]!

function summarize(durations: number[]): Timing {
  const sortedDurations = [...durations].sort((first, second) => first - second)
  return { median: getMedian(sortedDurations), p95: sortedDurations[Math.floor(sortedDurations.length * 0.95)]! }
}

async function view(server: Server, url: string) {
  const startedAt = performance.now()
  const response = await fetch(`${server.origin}${url}`, { redirect: 'manual' })
  await response.arrayBuffer()
  const duration = performance.now() - startedAt
  if (response.status !== 200) throw new Error(`The ${server.build} server answered ${url} with ${response.status}`)
  return duration
}

// In random order, so neither server always goes first.
async function viewPairs(servers: Server[], pairs: number, query: string) {
  const durations = new Map(servers.map((server) => [server, [] as number[]]))
  for (let pair = 0; pair < pairs; pair++) {
    const url = `${VIEWED_PATHS[pair % VIEWED_PATHS.length]!}${query}`
    const serverOrder = Math.random() < 0.5 ? servers : [...servers].reverse()
    for (const server of serverOrder) durations.get(server)!.push(await view(server, url))
  }
  return durations
}

// Before any timing: each proxy sends a seeded redirect's path on, and the baseline sends it nowhere.
async function checkRedirect(servers: Server[], path: string, destination: string) {
  for (const server of servers) {
    for (const query of server.build === 'win-over-documents-proxy' ? [QUERY, ''] : [QUERY]) {
      const response = await fetch(`${server.origin}${path}${query}`, { redirect: 'manual' })
      await response.arrayBuffer()
      const location = response.headers.get('location')
      if (server.build === 'baseline') {
        if (!location) continue
        throw new Error(`The baseline answered ${path}${query} with ${response.status} to ${location}, not without a redirect`)
      }
      const locationPath = location && new URL(location, server.origin).pathname
      if (response.status === 308 && locationPath === destination) continue
      throw new Error(
        `The ${server.build} build answered ${path}${query} with ${response.status} to ${location}, not 308 to ${destination}`
      )
    }
  }
}

type CaseSetup = {
  check: { destination: string; path: string }
  database: Database
  distance: Distance
  regexesWithoutFixedStart: number
  proxyBuild: ProxyBuild
  queryString: boolean
  redirects: number
  relay?: Relay
  url: string
}

async function timeCase({
  check,
  database,
  distance,
  regexesWithoutFixedStart,
  proxyBuild,
  queryString,
  redirects,
  relay,
  url
}: CaseSetup) {
  const label = `${proxyBuild}, ${database}, ${distance}, ${redirects.toLocaleString('en')} redirects${regexesWithoutFixedStart ? ` and ${regexesWithoutFixedStart} regexes without a fixed start` : ''}${queryString ? '' : ', page views without a query string'}`
  console.log(`Timing ${label}`)
  const [proxyServer, baselineServer] = await Promise.all([
    startServer(proxyBuild, database, url),
    startServer('baseline', database, url)
  ])
  const servers = [proxyServer, baselineServer]
  const query = queryString ? QUERY : ''
  try {
    await checkRedirect(servers, check.path, check.destination)
    await viewPairs(servers, WARM_UP_PAIRS, query)
    const sentBefore = relay?.readSentToDatabase()
    const durations = await viewPairs(servers, TIMED_PAIRS, query)
    const sentAfter = relay?.readSentToDatabase()
    const [proxy, baseline] = [summarize(durations.get(proxyServer)!), summarize(durations.get(baselineServer)!)]
    const result: CaseResult = {
      added: { median: proxy.median - baseline.median, p95: proxy.p95 - baseline.p95 },
      baseline,
      database,
      distance,
      regexesWithoutFixedStart,
      proxy,
      proxyBuild,
      queryString,
      redirects,
      requests: TIMED_PAIRS,
      sentToDatabasePerCheck: sentBefore === undefined ? undefined : roundToHundredths((sentAfter! - sentBefore) / TIMED_PAIRS)
    }
    return result
  } finally {
    await Promise.all(servers.map((server) => server.stop()))
  }
}

async function ping(database: Database, payload: Payload) {
  if (database === 'mongodb') return (payload.db as unknown as MongooseAdapter).connection.db!.command({ ping: 1 })
  if (database === 'postgres') return (payload.db as unknown as PostgresAdapter).pool.query('select 1')
  return (payload.db as unknown as SQLiteAdapter).client.execute('select 1')
}

async function readDatabaseVersion(database: Database, payload: Payload) {
  if (database === 'mongodb') {
    return String((await (payload.db as unknown as MongooseAdapter).connection.db!.admin().buildInfo()).version)
  }
  if (database === 'postgres') {
    const { rows } = await (payload.db as unknown as PostgresAdapter).pool.query<{ server_version: string }>(
      'show server_version'
    )
    return rows[0]!.server_version
  }
  const { rows } = await (payload.db as unknown as SQLiteAdapter).client.execute('select sqlite_version() as version')
  return String(rows[0]!.version)
}

async function measureRoundTrip(database: Database, payload: Payload) {
  for (let query = 0; query < ROUND_TRIP_QUERIES.warmUp; query++) await ping(database, payload)
  const durations: number[] = []
  for (let query = 0; query < ROUND_TRIP_QUERIES.timed; query++) {
    const startedAt = performance.now()
    await ping(database, payload)
    durations.push(performance.now() - startedAt)
  }
  return summarize(durations).median
}

// A lookup reads the from and regexPath indexes, which MongoDB builds after Payload connects.
async function waitForMongodbIndexes(payload: Payload) {
  const adapter = payload.db as unknown as MongooseAdapter
  await Promise.all([...Object.values(adapter.collections), ...Object.values(adapter.versions)].map((model) => model.init()))
  const indexes = (await adapter.collections.redirects!.collection.indexes()).map(({ name }) => name)
  for (const index of ['from_1', 'regexPath_1']) {
    if (!indexes.includes(index)) throw new Error(`MongoDB has no ${index} index on the redirects, only ${indexes.join(', ')}`)
  }
}

let payloadInstances = 0

const startPayload = async (database: Database, url: string, createSchema: boolean) =>
  getPayload({ config: buildBenchConfig({ createSchema, database, url }), key: `bench-${payloadInstances++}` })

async function measureRoundTrips(database: Database, payload: Payload, relayedUrl: string) {
  const relayedPayload = await startPayload(database, relayedUrl, false)
  const stopRelayedPayload = holdStop(() => relayedPayload.destroy())
  const roundTrip = {
    relayed: await measureRoundTrip(database, relayedPayload),
    'same-machine': await measureRoundTrip(database, payload)
  }
  await stopRelayedPayload()
  return roundTrip
}

async function benchDatabase(database: Database, directory: string, cases: CaseResult[]): Promise<DatabaseResult> {
  const stops: (() => Promise<unknown>)[] = []
  try {
    const startedDatabase = await startDatabase(database, directory)
    stops.push(holdStop(startedDatabase.stop))
    // The bench's own instance, outside production, creates the schema the servers then read.
    const payload = await startPayload(database, startedDatabase.url, true)
    stops.push(holdStop(() => payload.destroy()))
    if (database === 'mongodb') await waitForMongodbIndexes(payload)
    const result: DatabaseResult = { database, version: await readDatabaseVersion(database, payload) }

    const distances: { distance: Distance; relay?: Relay; url: string }[] = [
      { distance: 'same-machine', url: startedDatabase.url }
    ]
    if (startedDatabase.buildRelayedUrl && startedDatabase.port) {
      const relay = await startRelay(startedDatabase.port)
      stops.push(holdStop(relay.stop))
      const relayedUrl = startedDatabase.buildRelayedUrl(relay.port)
      distances.push({ distance: 'relayed', relay, url: relayedUrl })
      result.roundTrip = await measureRoundTrips(database, payload, relayedUrl)
    }

    const seeder = await createSeeder(payload)
    // Built per case, since no redirect to a page exists before the first count is seeded.
    const buildCheck = () => {
      const { from, page } = seeder.redirectToPage
      return { destination: `${seeder.buildPagePath(page!)}/checked`, path: `${from}/checked` }
    }
    const timeAt = async (
      caseDistances: typeof distances,
      setup: Pick<CaseSetup, 'proxyBuild' | 'queryString' | 'redirects' | 'regexesWithoutFixedStart'>
    ) => {
      for (const { distance, relay, url } of caseDistances) {
        cases.push(await timeCase({ ...setup, check: buildCheck(), database, distance, relay, url }))
      }
    }
    for (const count of RUN.counts) {
      console.log(`Seeding ${database} to ${count.toLocaleString('en')} redirects and as many regexes`)
      await seeder.growTo(count)
      await timeAt(distances, {
        proxyBuild: 'query-string-proxy',
        queryString: true,
        redirects: count,
        regexesWithoutFixedStart: 0
      })
    }
    const mostRedirects = getMostRedirects(RUN)
    // The proxy for query strings lets a page view without one through before it asks the database, so
    // the database's distance and the number of redirects don't change it: only the same machine.
    await timeAt(distances.slice(0, 1), {
      proxyBuild: 'query-string-proxy',
      queryString: false,
      redirects: mostRedirects,
      regexesWithoutFixedStart: 0
    })
    // The proxy for redirects that win over pages asks the database on every page view, so its cases
    // time the ones the proxy for query strings lets through: page views without a query string.
    await timeAt(distances, {
      proxyBuild: 'win-over-documents-proxy',
      queryString: false,
      redirects: mostRedirects,
      regexesWithoutFixedStart: 0
    })
    await addRegexesWithoutFixedStart(payload)
    await timeAt(distances, {
      proxyBuild: 'query-string-proxy',
      queryString: true,
      redirects: mostRedirects,
      regexesWithoutFixedStart: REGEXES_WITHOUT_FIXED_START.length
    })
    return result
  } finally {
    for (const stop of stops.reverse()) await stop()
  }
}

const runStartedAt = performance.now()
await checkReadme(RUN)
const machine = await readMachine()
const directory = await mkdtemp(path.join(tmpdir(), 'redirects-bench-'))
const removeDirectory = holdStop(
  () => rm(directory, { force: true, recursive: true }),
  () => rmSync(directory, { force: true, recursive: true })
)
try {
  for (const build of BUILDS) {
    console.log(`Building the ${build} build`)
    await buildApp(build)
  }
  const cases: CaseResult[] = []
  const databases: DatabaseResult[] = []
  for (const database of RUN.databases) databases.push(await benchDatabase(database, directory, cases))

  printAll(cases, databases, RUN)
  await writeReport(cases, databases, machine, RUN)
  const growthWarnings = buildGrowthWarnings(cases, RUN)
  console.log(
    growthWarnings.length === 0
      ? `\nNo added time grew over 1.5 times from the fewest redirects to the most.`
      : `\nAdded time that grew over 1.5 times:\n${growthWarnings.map((warning) => `- ${warning}`).join('\n')}`
  )
  const seconds = Math.round((performance.now() - runStartedAt) / 1_000)
  console.log(`\nThe run took ${Math.floor(seconds / 60)} min ${seconds % 60} s.`)
} finally {
  await removeDirectory()
}
