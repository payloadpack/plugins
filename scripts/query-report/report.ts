import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** What one operation cost on one database: its query count, which is exact, and its median time. */
export type Measurement = { database: string; medianMs: number; operation: string; queries: number }

export type PackageReport = { base: Measurement[]; baseError?: string; name: string; pullRequest: Measurement[] }

/** One side's run of an operation, and how its queries are recorded. */
export type Side = { listQueries: (work: () => Promise<unknown>) => Promise<unknown[]>; run: (index: number) => Promise<unknown> }

export const WARM_UP_RUNS = 10

// A row is flagged when the pull request adds a query, or is slower by both of these, so a runner's
// noise on a fast operation flags nothing.
const GAP_MS = 5
const GAP_SHARE = 0.25

// Beside the package's own src, so the base's imports resolve to the same dependencies. Git ignores it.
const BASE_FOLDER = '.query-report-base'

/**
 * The package's entry as the base held it: the base's src, taken from git into a folder beside the
 * package's own, so only the package's code differs from the pull request's. The base is
 * QUERY_REPORT_BASE, or origin/main without it.
 */
export async function importBaseSource<Version>(packageDirectory: string): Promise<Version> {
  const base = process.env.QUERY_REPORT_BASE || 'origin/main'
  const readGit = (...args: string[]) => execFileSync('git', args, { cwd: packageDirectory, encoding: 'utf8' }).trim()
  // From the repository's root, since git archive run in a folder takes only what is below it.
  const archive = execFileSync('git', ['archive', `${base}:${readGit('rev-parse', '--show-prefix')}src`], {
    cwd: readGit('rev-parse', '--show-toplevel')
  })
  const folder = path.join(packageDirectory, BASE_FOLDER)
  await rm(folder, { force: true, recursive: true })
  await mkdir(folder)
  execFileSync('tar', ['-x', '-C', folder], { input: archive })
  return import(/* @vite-ignore */ path.join(folder, 'index.ts'))
}

export const removeBaseSource = (packageDirectory: string) =>
  rm(path.join(packageDirectory, BASE_FOLDER), { force: true, recursive: true })

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
 * round, so a runner that slows for a while slows both. The first runs warm up and aren't counted.
 */
export async function measureInTurns(
  report: PackageReport,
  database: string,
  operation: string,
  runs: number,
  sides: { base?: Side; pullRequest: Side }
) {
  const order = sides.base ? (['base', 'pullRequest'] as const) : (['pullRequest'] as const)
  const times: Record<string, number[]> = { base: [], pullRequest: [] }
  const queries: Record<string, number> = {}
  for (let index = 0; index < WARM_UP_RUNS + runs; index++) {
    for (const side of index % 2 === 0 ? order : [...order].reverse()) {
      const startedAt = performance.now()
      queries[side] = (await sides[side]!.listQueries(() => sides[side]!.run(index))).length
      if (index >= WARM_UP_RUNS) times[side]!.push(performance.now() - startedAt)
    }
  }
  for (const side of order) {
    report[side].push({ database, medianMs: getMedian(times[side]!), operation, queries: queries[side]! })
  }
}

// Where QUERY_REPORT_OUTPUT names, for the comment's run of this script to read.
export async function writeReport(report: PackageReport) {
  const output = process.env.QUERY_REPORT_OUTPUT
  if (!output) throw new Error('Set QUERY_REPORT_OUTPUT to the file the report is written to.')
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report))
}

// A change that rounds to nothing reads ±0, whichever side of it the value fell.
function formatSigned(value: number, unit: string) {
  const rounded = Math.abs(value).toFixed(unit === '%' ? 0 : 2)
  return `${Number(rounded) === 0 ? '±' : value > 0 ? '+' : '−'}${rounded}${unit}`
}

function formatRow(pullRequest: Measurement, base: Measurement | undefined) {
  const label = `| ${pullRequest.operation} | ${pullRequest.database} |`
  if (!base) return `${label} – → ${pullRequest.queries} | – → ${pullRequest.medianMs.toFixed(2)} ms | new |`
  const changeMs = pullRequest.medianMs - base.medianMs
  const changeShare = changeMs / base.medianMs
  const flagged = pullRequest.queries > base.queries || (changeMs > GAP_MS && changeShare > GAP_SHARE)
  return `${label} ${base.queries} → ${pullRequest.queries} | ${base.medianMs.toFixed(2)} → ${pullRequest.medianMs.toFixed(2)} ms | ${formatSigned(changeMs, ' ms')} (${formatSigned(changeShare * 100, '%')})${flagged ? ' ⚠️' : ''} |`
}

/** The pull request's comment: a table per package, base against this pull request. */
export function formatQueryReport(reports: (PackageReport | { error: string; name: string })[]) {
  const sections = reports.map((report) => {
    if ('error' in report) return `#### @payloadpack/${report.name}\n\n${report.error}`
    const findBase = ({ database, operation }: Measurement) =>
      report.base.find((row) => row.database === database && row.operation === operation)
    return [
      `#### @payloadpack/${report.name}`,
      ...(report.baseError ? ['', `The base couldn't be measured, so every row is new: ${report.baseError}`] : []),
      '',
      '| Operation | Database | Queries | Median | Difference |',
      '| --- | --- | ---: | ---: | ---: |',
      ...report.pullRequest.map((row) => formatRow(row, findBase(row)))
    ].join('\n')
  })
  return [
    '### Query report',
    '',
    `Each operation on the PR's base and on this PR, in turns on the same runner. Query counts are exact; times are medians and vary with the runner. ⚠️ marks a row that adds a query, or is slower by more than ${GAP_MS} ms and ${GAP_SHARE * 100}%.`,
    ...sections.map((section) => `\n${section}`)
  ].join('\n')
}

// Each argument is the report a package's run wrote, named for the package. A missing one is a run that
// stopped before it wrote, which the comment says.
if (import.meta.main) {
  const reports = await Promise.all(
    process.argv.slice(2).map((file) =>
      readFile(file, 'utf8').then(
        (text) => JSON.parse(text) as PackageReport,
        () => ({
          error: 'The run stopped before it wrote its report. The workflow log says why.',
          name: path.basename(file, '.json')
        })
      )
    )
  )
  console.log(formatQueryReport(reports))
}
