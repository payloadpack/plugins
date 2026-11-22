import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { PackageReport } from './report.js'

// What a package's test/query-report.ts measures with: its sites, the base's and the pull request's,
// and the runs in turns on each database.

/** A site with one version of the package: its Payload, and how its queries are recorded. */
type Site = {
  listQueries: (work: () => Promise<unknown>) => Promise<unknown[]>
  payload: { destroy: () => Promise<void> }
}

type Side = { listQueries: Site['listQueries']; run: (index: number) => Promise<unknown> }

export type Measure<PackageSite> = (
  operation: string,
  runs: number,
  run: (site: PackageSite, index: number) => Promise<unknown>
) => Promise<void>

const DATABASE_LABELS = { mongodb: 'MongoDB', postgres: 'Postgres', sqlite: 'SQLite' }

export const WARM_UP_RUNS = 10

// Beside the package's own src, so the base's imports resolve to the same dependencies. Git ignores it.
const BASE_FOLDER = '.query-report-base'

/**
 * The package's entry as the base held it: the base's src, taken from git into a folder beside the
 * package's own, so only the package's code differs from the pull request's. The base is
 * QUERY_REPORT_BASE, or origin/main without it.
 */
async function importBaseSource<Version>(packageDirectory: string): Promise<Version> {
  const base = process.env.QUERY_REPORT_BASE || 'origin/main'
  const readGit = (...args: string[]) => execFileSync('git', args, { cwd: packageDirectory, encoding: 'utf8' }).trim()
  // From the repository's root, since git archive run in a folder takes only what is below it. The
  // archive has no size limit, which a growing src would otherwise reach.
  const archive = execFileSync('git', ['archive', `${base}:${readGit('rev-parse', '--show-prefix')}src`], {
    cwd: readGit('rev-parse', '--show-toplevel'),
    maxBuffer: Infinity
  })
  const folder = path.join(packageDirectory, BASE_FOLDER)
  await rm(folder, { force: true, recursive: true })
  await mkdir(folder)
  execFileSync('tar', ['-x', '-C', folder], { input: archive })
  return import(/* @vite-ignore */ path.join(folder, 'index.ts'))
}

// The base's part of the work, or nothing when it fails, as when the pull request changes what the
// report passes to both versions: the comment says why, and the pull request's rows stay.
async function tryBase<Result>(report: PackageReport, work: () => Promise<Result>) {
  try {
    return await work()
  } catch (error) {
    report.baseError ??= String(error)
  }
}

/** Runs the work on the items 50 at a time, so seeding takes seconds, and returns its results in order. */
export async function mapInChunks<Item, Result>(items: Item[], work: (item: Item, index: number) => Promise<Result>) {
  const results: Result[] = []
  for (let start = 0; start < items.length; start += 50) {
    results.push(...(await Promise.all(items.slice(start, start + 50).map((item, offset) => work(item, start + offset)))))
  }
  return results
}

const getMedian = (values: number[]) => [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)]!

/**
 * Runs an operation on the base and the pull request in turns, the side that goes first changing every
 * round, so a runner that slows for a while slows both. The first runs warm up and aren't counted. A
 * base that fails the operation leaves its row without a base.
 */
async function measureInTurns(
  report: PackageReport,
  database: string,
  operation: string,
  runs: number,
  sides: { base?: Side; pullRequest: Side }
) {
  let measuredSides: ('base' | 'pullRequest')[] = sides.base ? ['base', 'pullRequest'] : ['pullRequest']
  const times = { base: [] as number[], pullRequest: [] as number[] }
  const queries = { base: 0, pullRequest: 0 }
  for (let index = 0; index < WARM_UP_RUNS + runs; index++) {
    for (const side of index % 2 === 0 ? measuredSides : [...measuredSides].reverse()) {
      const startedAt = performance.now()
      try {
        queries[side] = (await sides[side]!.listQueries(() => sides[side]!.run(index))).length
      } catch (error) {
        if (side === 'pullRequest') throw error
        report.baseError ??= `${operation} on ${database}: ${String(error)}`
        measuredSides = ['pullRequest']
        continue
      }
      if (index >= WARM_UP_RUNS) times[side].push(performance.now() - startedAt)
    }
  }
  for (const side of measuredSides) {
    report[side].push({ database, medianMs: getMedian(times[side]), operation, queries: queries[side] })
  }
}

/**
 * A package's query report: each database measured by its own test, on a site with the pull request's
 * version and one with the base's, and the report written when the last one is done. A report with a
 * database missing would read as complete, so a run that stops writes none.
 */
export async function startQueryReport<Version, Database extends keyof typeof DATABASE_LABELS, PackageSite extends Site>({
  databases,
  name,
  packageDirectory,
  pullRequestVersion,
  startSite
}: {
  databases: Database[]
  name: string
  packageDirectory: string
  pullRequestVersion: Version
  startSite: (version: Version, database: Database) => Promise<PackageSite>
}) {
  const report: PackageReport = { base: [], name, pullRequest: [] }
  const baseVersion = await tryBase(report, () => importBaseSource<Version>(packageDirectory))
  let measuredDatabases = 0
  return {
    async finish() {
      await rm(path.join(packageDirectory, BASE_FOLDER), { force: true, recursive: true })
      if (measuredDatabases < databases.length) return
      const output = process.env.QUERY_REPORT_OUTPUT
      if (!output) throw new Error('Set QUERY_REPORT_OUTPUT to the file the report is written to.')
      await mkdir(path.dirname(output), { recursive: true })
      await writeFile(output, JSON.stringify(report))
    },
    async measureDatabase(database: Database, work: (measure: Measure<PackageSite>) => Promise<void>) {
      const pullRequest = await startSite(pullRequestVersion, database)
      const base = baseVersion && (await tryBase(report, () => startSite(baseVersion, database)))
      try {
        await work((operation, runs, run) =>
          measureInTurns(report, DATABASE_LABELS[database], operation, runs, {
            base: base && { listQueries: base.listQueries, run: (index) => run(base, index) },
            pullRequest: { listQueries: pullRequest.listQueries, run: (index) => run(pullRequest, index) }
          })
        )
        measuredDatabases++
      } finally {
        await pullRequest.payload.destroy()
        await base?.payload.destroy()
      }
    }
  }
}
