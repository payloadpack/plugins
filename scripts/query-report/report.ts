import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** What one operation cost on one database: its query count, which is exact, and its median time. */
export type Measurement = { database: string; medianMs: number; operation: string; queries: number }

export type PackageReport = { base: Measurement[]; baseError?: string; name: string; pullRequest: Measurement[] }

// A row is flagged when the pull request adds a query, or is slower by both of these, so a runner's
// noise on a fast operation flags nothing.
const GAP_MS = 5
const GAP_SHARE = 0.25

// Times in hundredths of a millisecond, as the table shows them, so a row's difference adds up to its
// medians.
const toHundredths = (ms: number) => Math.round(ms * 100)
const formatHundredths = (hundredths: number) => (hundredths / 100).toFixed(2)

function formatRow(pullRequest: Measurement, base: Measurement | undefined) {
  const label = `| ${pullRequest.operation} | ${pullRequest.database} |`
  const pullRequestTime = toHundredths(pullRequest.medianMs)
  if (!base) return `${label} – → ${pullRequest.queries} | – → ${formatHundredths(pullRequestTime)} ms | new |`
  const baseTime = toHundredths(base.medianMs)
  const change = pullRequestTime - baseTime
  const sign = change === 0 ? '±' : change > 0 ? '+' : '−'
  const share = baseTime ? ` (${sign}${Math.abs((change / baseTime) * 100).toFixed(1)}%)` : ''
  const flagged = pullRequest.queries > base.queries || (change > GAP_MS * 100 && change > GAP_SHARE * baseTime)
  return `${label} ${base.queries} → ${pullRequest.queries} | ${formatHundredths(baseTime)} → ${formatHundredths(pullRequestTime)} ms | ${sign}${formatHundredths(Math.abs(change))} ms${share}${flagged ? ' ⚠️' : ''} |`
}

/** The pull request's comment: a table per package, base against this pull request. */
export function formatQueryReport(reports: (PackageReport | { error: string; name: string })[]) {
  const sections = reports.map((report) => {
    if ('error' in report) return `#### @payloadpack/${report.name}\n\n${report.error}`
    const findBase = ({ database, operation }: Measurement) =>
      report.base.find((row) => row.database === database && row.operation === operation)
    return [
      `#### @payloadpack/${report.name}`,
      ...(report.baseError ? ['', `Rows that read new have no base to compare with: ${report.baseError}`] : []),
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

// Each argument is the report a package's run wrote, named for the package. A missing or unreadable one
// is a run that stopped before it wrote, which the comment says.
if (import.meta.main) {
  const reports = await Promise.all(
    process.argv.slice(2).map((file) =>
      readFile(file, 'utf8')
        .then((text) => JSON.parse(text) as PackageReport)
        .catch(() => ({
          error: 'The run stopped before it wrote its report. The workflow log says why.',
          name: path.basename(file, '.json')
        }))
    )
  )
  console.log(formatQueryReport(reports))
}
