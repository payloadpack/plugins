import type { Database } from '../src/build-config.ts'
import { buildMarkdownTable, DATABASE_LABELS, formatCount, formatTiming, type Timing } from './report.ts'

// The README's place for the comparison's numbers, between <!-- speed-table-comparison:start --> and
// its end.
export const COMPARISON_README_TABLE = 'speed-table-comparison'

// Medians are rounded to hundredths of a millisecond, so either one may be this much off.
const ROUNDING = 0.005

// A cached lookup under this is close to ours on the same machine, which costs a few tenths of a
// millisecond. An absolute bound, so a run's noise can't push the README's text past a ratio.
const CLOSE_TO_OURS = 1

type ComparedCase = {
  database: Database
  redirects: number
  ours: { pathARedirectCovers: Timing }
  theirsListNotCached: { pathARedirectCovers: Timing }
  theirsListCached: { happensInNext: boolean; pathARedirectCovers: Timing }
}

// From the slowest ours and the fastest theirs the rounding allows, rounded down to two significant
// figures, so the figure never claims more than the run measured.
function formatTimesFaster(ours: number, theirs: number) {
  const times = (theirs - ROUNDING) / (ours + ROUNDING)
  if (times <= 1) throw new Error('findRedirect is no faster than the example website, which the README says it is.')
  const magnitude = 10 ** (Math.floor(Math.log10(times)) - 1)
  return `${formatCount(Math.floor(times / magnitude) * magnitude)}×`
}

/**
 * Finding the redirect that covers a path at the most redirects, on each database: with findRedirect,
 * the way Payload's example website finds one, and how many times faster findRedirect is. It throws
 * when the numbers stop saying what the README's text around the table says: that the list of the
 * most redirects is too big for Next's data cache, and that at the fewest, where the cache holds the
 * list, the example website's lookup costs close to ours.
 */
export function buildComparisonReadmeTable(cases: ComparedCase[]) {
  const counts = cases.map(({ redirects }) => redirects)
  const [mostRedirects, fewestRedirects] = [Math.max(...counts), Math.min(...counts)]
  const casesAtMost = cases.filter(({ redirects }) => redirects === mostRedirects)
  if (casesAtMost.some(({ theirsListCached }) => theirsListCached.happensInNext)) {
    throw new Error(`Next's data cache holds Payload's list of ${formatCount(mostRedirects)}, which the README says it can't.`)
  }
  for (const { database, theirsListCached } of cases.filter(({ redirects }) => redirects === fewestRedirects)) {
    if (!theirsListCached.happensInNext || theirsListCached.pathARedirectCovers.median >= CLOSE_TO_OURS) {
      throw new Error(
        `At ${formatCount(fewestRedirects)} on ${DATABASE_LABELS[database]}, the example website's cached lookup isn't close to ours, which the README says it is.`
      )
    }
  }
  return buildMarkdownTable(
    [
      `Finding one redirect among ${formatCount(mostRedirects)}`,
      '@payloadpack/redirects',
      "Payload's example website",
      'Times faster',
      'Example website, list cached'
    ],
    // The last column is what a lookup costs once a custom cache handler holds the list, which Next's
    // own limit doesn't stop: the README calls it the least that lookup costs then.
    casesAtMost.map(({ database, ours, theirsListCached, theirsListNotCached }) => [
      DATABASE_LABELS[database],
      formatTiming(ours.pathARedirectCovers),
      formatTiming(theirsListNotCached.pathARedirectCovers),
      formatTimesFaster(ours.pathARedirectCovers.median, theirsListNotCached.pathARedirectCovers.median),
      formatTiming(theirsListCached.pathARedirectCovers)
    ])
  )
}
