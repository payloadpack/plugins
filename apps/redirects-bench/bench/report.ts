import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { cpus, platform, release, totalmem, type } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { DATABASES, type Database } from '../src/build-config.ts'
import type { ProxyBuild } from './servers.ts'

export type Timing = { median: number; p95: number }

export type Distance = 'relayed' | 'same-machine'

export type CaseResult = {
  // What the proxy adds: the proxy build's median and p95 less the baseline's.
  added: Timing
  baseline: Timing
  database: Database
  distance: Distance
  regexesWithoutFixedStart: number
  proxy: Timing
  proxyBuild: ProxyBuild
  // Whether the page views carried a query string, which the proxy for query strings checks, or none,
  // which it lets through.
  queryString: boolean
  redirects: number
  // Timed requests to each server.
  requests: number
  // Behind the relay, the chunks the proxy server sent the database per timed request.
  sentToDatabasePerCheck?: number
}

export type DatabaseResult = {
  database: Database
  // The median of a trivial query, on the same machine and behind the relay.
  roundTrip?: Record<Distance, number>
  version: string
}

export type Run = {
  counts: number[]
  databases: Database[]
  relayDelayEachWay: number
  timedPairs: number
  warmUpPairs: number
}

export const FULL_RUN_COUNTS = [1_000, 10_000, 100_000]

export const DATABASE_LABELS: Record<Database, string> = { mongodb: 'MongoDB', postgres: 'Postgres', sqlite: 'SQLite' }

const DISTANCE_LABELS: Record<Distance, string> = {
  relayed: 'Database 5 ms away',
  'same-machine': 'Database on the same machine'
}

const PROXY_BUILD_LABELS: Record<ProxyBuild, string> = {
  'query-string-proxy': 'For query strings',
  'win-over-documents-proxy': 'For redirects that win over pages'
}

const REPORT_FILES = {
  json: fileURLToPath(new URL('../../docs/src/data/redirects-speed.json', import.meta.url)),
  readme: fileURLToPath(new URL('../../../packages/redirects/README.md', import.meta.url))
}

// Over this many times the added time at the fewest redirects, the most redirects are flagged.
const GROWTH_FLAGGED = 1.5

export const isFullRun = ({ counts, databases }: Pick<Run, 'counts' | 'databases'>) =>
  counts.join() === FULL_RUN_COUNTS.join() && databases.join() === DATABASES.join()

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

/** The redirect counts, fewest first, and the databases a run times, all of them unless narrowed. */
export const readNarrowing = (): Pick<Run, 'counts' | 'databases'> => ({
  counts: readList('BENCH_COUNTS', FULL_RUN_COUNTS, Number, (count) => Number.isInteger(count) && count >= 1_000).sort(
    (first, second) => first - second
  ),
  databases: readList<Database>(
    'BENCH_DATABASES',
    [...DATABASES],
    (value) => value as Database,
    (value) => DATABASES.includes(value)
  )
})

const getMedian = (sortedDurations: number[]) => sortedDurations[Math.floor(sortedDurations.length / 2)]!

export function summarize(durations: number[]): Timing {
  const sortedDurations = [...durations].sort((first, second) => first - second)
  return { median: getMedian(sortedDurations), p95: sortedDurations[Math.floor(sortedDurations.length * 0.95)]! }
}

export const getMostRedirects = ({ counts }: Run) => Math.max(...counts)

export const roundToHundredths = (value: number) => Math.round(value * 100) / 100

// A second or more reads in seconds, as 1.3 s, the way the docs show it.
const formatTime = (milliseconds: number) =>
  Math.abs(milliseconds) >= 1_000
    ? `${(milliseconds / 1_000).toLocaleString('en', { maximumFractionDigits: 1 })} s`
    : `${milliseconds.toLocaleString('en', { maximumFractionDigits: Math.abs(milliseconds) < 10 ? 2 : 1 })} ms`

export const formatTiming = ({ median, p95 }: Timing) => `${formatTime(median)} (${formatTime(p95)})`

export const formatCount = (count: number) => count.toLocaleString('en')

// A Markdown table with its columns padded to one width, as Prettier formats the README's.
export function buildMarkdownTable(header: string[], rows: string[][]) {
  const widths = header.map((title, column) => Math.max(3, title.length, ...rows.map((row) => row[column]!.length)))
  const line = (cells: string[]) => `| ${cells.map((cell, column) => cell.padEnd(widths[column]!)).join(' | ')} |`
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n')
}

type CaseQuery = { proxyBuild?: ProxyBuild; queryString?: boolean }

const getCase = (
  cases: CaseResult[],
  database: Database,
  distance: Distance,
  redirects: number,
  { proxyBuild = 'query-string-proxy', queryString = true }: CaseQuery = {}
) =>
  cases.find(
    (result) =>
      result.database === database &&
      result.distance === distance &&
      result.redirects === redirects &&
      result.regexesWithoutFixedStart === 0 &&
      result.proxyBuild === proxyBuild &&
      result.queryString === queryString
  )

function buildQueryStringProxyTable(cases: CaseResult[], run: Run) {
  const mostRedirects = getMostRedirects(run)
  return buildMarkdownTable(
    [
      '',
      'Without a query string',
      `With one, ${DISTANCE_LABELS['same-machine'].toLowerCase()}`,
      `With one, ${DISTANCE_LABELS.relayed.toLowerCase()}`
    ],
    run.databases.map((database) => {
      const relayedCase = getCase(cases, database, 'relayed', mostRedirects)
      return [
        DATABASE_LABELS[database],
        formatTiming(getCase(cases, database, 'same-machine', mostRedirects, { queryString: false })!.added),
        formatTiming(getCase(cases, database, 'same-machine', mostRedirects)!.added),
        relayedCase ? formatTiming(relayedCase.added) : 'Same machine only'
      ]
    })
  )
}

function buildWinOverDocumentsProxyTable(cases: CaseResult[], run: Run) {
  const mostRedirects = getMostRedirects(run)
  const query: CaseQuery = { proxyBuild: 'win-over-documents-proxy', queryString: false }
  return buildMarkdownTable(
    ['', DISTANCE_LABELS['same-machine'], DISTANCE_LABELS.relayed],
    run.databases.map((database) => {
      const relayedCase = getCase(cases, database, 'relayed', mostRedirects, query)
      return [
        DATABASE_LABELS[database],
        formatTiming(getCase(cases, database, 'same-machine', mostRedirects, query)!.added),
        relayedCase ? formatTiming(relayedCase.added) : 'Same machine only'
      ]
    })
  )
}

// Each table the README shows, between its own markers.
const README_TABLES = {
  'speed-table': buildQueryStringProxyTable,
  'speed-table-win-over-documents': buildWinOverDocumentsProxyTable
}

const README_TABLE_NAMES = Object.keys(README_TABLES) as (keyof typeof README_TABLES)[]

function buildCaseTable(cases: CaseResult[]) {
  return buildMarkdownTable(
    [
      'Proxy',
      'Database',
      'Distance',
      'Redirects',
      'Regexes without a fixed start',
      'Query string',
      'With proxy',
      'Baseline',
      'Added',
      'Sent per check'
    ],
    cases.map((result) => [
      PROXY_BUILD_LABELS[result.proxyBuild],
      DATABASE_LABELS[result.database],
      DISTANCE_LABELS[result.distance],
      formatCount(result.redirects),
      String(result.regexesWithoutFixedStart),
      result.queryString ? 'Yes' : 'No',
      formatTiming(result.proxy),
      formatTiming(result.baseline),
      formatTiming(result.added),
      result.sentToDatabasePerCheck === undefined ? '' : String(result.sentToDatabasePerCheck)
    ])
  )
}

/**
 * The round trips one check makes to the database: the time the relay added to a check, over the
 * time it added to a trivial query, at the most redirects.
 */
function countRoundTrips(cases: CaseResult[], { database, roundTrip }: DatabaseResult, run: Run) {
  if (!roundTrip) return undefined
  const mostRedirects = getMostRedirects(run)
  const relayedCase = getCase(cases, database, 'relayed', mostRedirects)
  const sameMachineCase = getCase(cases, database, 'same-machine', mostRedirects)
  if (!relayedCase || !sameMachineCase) return undefined
  return roundToHundredths(
    (relayedCase.added.median - sameMachineCase.added.median) / (roundTrip.relayed - roundTrip['same-machine'])
  )
}

export function buildGrowthWarnings(cases: CaseResult[], run: Run) {
  const [fewestRedirects, mostRedirects] = [Math.min(...run.counts), getMostRedirects(run)]
  if (fewestRedirects === mostRedirects) return []
  return cases.flatMap((result) => {
    if (
      result.proxyBuild !== 'query-string-proxy' ||
      result.redirects !== mostRedirects ||
      result.regexesWithoutFixedStart > 0 ||
      !result.queryString
    ) {
      return []
    }
    const fewestCase = getCase(cases, result.database, result.distance, fewestRedirects)!
    return (['median', 'p95'] as const)
      .filter((measure) => result.added[measure] > GROWTH_FLAGGED * fewestCase.added[measure])
      .map(
        (measure) =>
          `${DATABASE_LABELS[result.database]}, ${DISTANCE_LABELS[result.distance].toLowerCase()}: the ${measure} added ${formatTime(result.added[measure])} at ${formatCount(mostRedirects)}, over ${GROWTH_FLAGGED} times ${formatTime(fewestCase.added[measure])} at ${formatCount(fewestRedirects)}`
      )
  })
}

export function printAll(cases: CaseResult[], databases: DatabaseResult[], run: Run) {
  const mostRedirects = formatCount(getMostRedirects(run))
  console.log(
    `\nWhat the proxy for query strings adds to a page view at ${mostRedirects} redirects, median (p95):\n\n${buildQueryStringProxyTable(cases, run)}`
  )
  console.log(
    `\nWhat the proxy for redirects that win over pages adds to every page view at ${mostRedirects} redirects, median (p95):\n\n${buildWinOverDocumentsProxyTable(cases, run)}`
  )
  console.log(
    `\nEvery case, ${formatCount(run.timedPairs)} requests to each server after ${formatCount(run.warmUpPairs)} untimed pairs:\n\n${buildCaseTable(cases)}`
  )
  for (const result of databases) {
    const { database, roundTrip, version } = result
    const roundTrips = countRoundTrips(cases, result, run)
    console.log(
      `\n${DATABASE_LABELS[database]} ${version}` +
        (roundTrip
          ? `: a trivial query takes ${formatTime(roundTrip['same-machine'])} on the same machine and ${formatTime(roundTrip.relayed)} through the relay` +
            (roundTrips === undefined ? '.' : `, so a check makes ${roundTrips} round trips.`)
          : ', on the same machine only.')
    )
  }
}

async function readOperatingSystem() {
  if (platform() !== 'darwin') return `${type()} ${release()}`
  const { stdout } = await promisify(execFile)('sw_vers', ['-productVersion'])
  return `macOS ${stdout.trim()}`
}

// The version installed for the app, read off the package's own package.json, which Payload doesn't export.
export async function readVersion(packageName: string) {
  const file = fileURLToPath(new URL(`../node_modules/${packageName}/package.json`, import.meta.url))
  return (JSON.parse(await readFile(file, 'utf8')) as { version: string }).version
}

type Machine = Awaited<ReturnType<typeof readMachine>>

/** What the run runs on, but the databases, read before it starts so a run that can't tell fails at once. */
export const readMachine = async () => ({
  memoryGigabytes: Math.round(totalmem() / 1024 ** 3),
  next: await readVersion('next'),
  node: process.version.replace(/^v/, ''),
  operatingSystem: await readOperatingSystem(),
  payload: await readVersion('payload'),
  processor: cpus()[0]?.model ?? 'an unknown processor'
})

function getTablePlace(readme: string, table: string) {
  const [start, end] = [`<!-- ${table}:start -->`, `<!-- ${table}:end -->`]
  const [startAt, endAt] = [readme.indexOf(start), readme.indexOf(end)]
  if (startAt === -1 || endAt < startAt) {
    throw new Error(`${REPORT_FILES.readme} needs ${start} and ${end}, in that order, for the table to go between.`)
  }
  return { after: readme.slice(endAt), before: readme.slice(0, startAt + start.length) }
}

// Called before a run starts anything, so a full run finds out at once that the README has no place
// for one of its tables.
export async function checkReadme(run: Run) {
  if (!isFullRun(run)) return
  const readme = await readFile(REPORT_FILES.readme, 'utf8')
  for (const table of README_TABLE_NAMES) getTablePlace(readme, table)
}

/** Throws when the README has no markers for the table, so a run that would write it fails at once. */
export async function checkReadmeTable(table: string) {
  getTablePlace(await readFile(REPORT_FILES.readme, 'utf8'), table)
}

/** Puts a table of another run, such as the comparison's, between its markers in the README. */
export async function writeReadmeTable(table: string, content: string) {
  const readme = await readFile(REPORT_FILES.readme, 'utf8')
  const { after, before } = getTablePlace(readme, table)
  await writeFile(REPORT_FILES.readme, `${before}\n\n${content}\n\n${after}`)
}

const roundTiming = ({ median, p95 }: Timing) => ({ median: roundToHundredths(median), p95: roundToHundredths(p95) })

// Only the full run writes, so neither file ever holds a narrowed run's numbers.
export async function writeReport(cases: CaseResult[], databases: DatabaseResult[], machine: Machine, run: Run) {
  if (!isFullRun(run)) {
    console.log(
      `\nNothing written, because only a run of ${DATABASES.join(', ')} at ${FULL_RUN_COUNTS.map(formatCount).join(', ')} redirects writes its numbers.`
    )
    return
  }
  const report = {
    ranOn: { date: new Date().toISOString().slice(0, 10), ...machine },
    relayDelayEachWay: run.relayDelayEachWay,
    timedPairs: run.timedPairs,
    warmUpPairs: run.warmUpPairs,
    databases: databases.map((result) => ({
      database: result.database,
      version: result.version,
      roundTrip: result.roundTrip && {
        relayed: roundToHundredths(result.roundTrip.relayed),
        'same-machine': roundToHundredths(result.roundTrip['same-machine'])
      },
      roundTripsPerCheck: countRoundTrips(cases, result, run)
    })),
    cases: cases.map((result) => ({
      proxyBuild: result.proxyBuild,
      database: result.database,
      distance: result.distance,
      redirects: result.redirects,
      regexesWithoutFixedStart: result.regexesWithoutFixedStart,
      queryString: result.queryString,
      requests: result.requests,
      added: roundTiming(result.added),
      proxy: roundTiming(result.proxy),
      baseline: roundTiming(result.baseline),
      sentToDatabasePerCheck: result.sentToDatabasePerCheck
    }))
  }
  let readme = await readFile(REPORT_FILES.readme, 'utf8')
  for (const table of README_TABLE_NAMES) {
    const { after, before } = getTablePlace(readme, table)
    readme = `${before}\n\n${README_TABLES[table](cases, run)}\n\n${after}`
  }
  await writeFile(REPORT_FILES.json, `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(REPORT_FILES.readme, readme)
  console.log(`\nWritten to ${REPORT_FILES.json} and ${REPORT_FILES.readme}.`)
}
