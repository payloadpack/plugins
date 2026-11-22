import comparison from '../../data/redirects-comparison.json'

import { DATABASE_LABELS, formatCount } from './speed'

// The numbers of the last full run of `bun run bench:compare` in apps/redirects-bench, which writes
// redirects-comparison.json: finding one redirect with findRedirect, and the way Payload's example
// website finds one with Payload's own redirects plugin.
export { comparison }

const redirectCounts = comparison.cases.map(({ redirects }) => redirects)
export const MOST_REDIRECTS = Math.max(...redirectCounts)
export const FEWEST_REDIRECTS = Math.min(...redirectCounts)

export const listDatabases = () =>
  comparison.databases
    .map(({ database }) => DATABASE_LABELS[database]!)
    .join(', ')
    .replace(/, ([^,]*)$/, ' and $1')

// Under 10 ms a time keeps two decimals, and over it one, as the README's tables do.
export function formatTime(milliseconds: number) {
  if (milliseconds >= 1_000) return `${(milliseconds / 1_000).toLocaleString('en', { maximumFractionDigits: 1 })} s`
  return `${milliseconds.toLocaleString('en', { maximumFractionDigits: milliseconds < 10 ? 2 : 1 })} ms`
}

// A range joins its ends with an en dash and gives the unit once, as 0.19–0.36 ms or 1.3–1.5 s.
export function formatRange(milliseconds: number[]) {
  const [low, high] = [Math.min(...milliseconds), Math.max(...milliseconds)].map(formatTime)
  if (low === high) return low!
  const [lowNumber, lowUnit] = low!.split(' ')
  const [highNumber, highUnit] = high!.split(' ')
  return lowUnit === highUnit ? `${lowNumber}–${highNumber} ${highUnit}` : `${low}–${high}`
}

// Medians are rounded to hundredths of a millisecond, so either one may be this much off.
const ROUNDING = 0.005

// Two medians this close or closer either way are about the same.
const ABOUT_THE_SAME = 1.25

// A cached lookup under this is close to ours on the same machine, which costs a few tenths of a
// millisecond. An absolute bound, so a run's noise can't push the caption past a ratio.
const CLOSE_TO_OURS = 1

const findCases = (redirects: number) => comparison.cases.filter((result) => result.redirects === redirects)

const findCaseOn = (cases: ComparisonCase[], database: string) => cases.find((result) => result.database === database)!

const compareMedians = (first: number, second: number) => Math.max(first, second) / Math.min(first, second)

type ComparisonCase = (typeof comparison.cases)[number]

/**
 * The speed row and the caption of the comparison: the medians of finding the redirect that covers a
 * path, on every database. It throws when the numbers stop saying what the row and the caption say,
 * so a run that changes them can't leave the page saying something else.
 */
export function buildSpeedSummary() {
  const most = findCases(MOST_REDIRECTS)
  const fewest = findCases(FEWEST_REDIRECTS)
  const ours = most.map((result) => result.ours.pathARedirectCovers.median)
  const theirs = most.map((result) => result.theirsListNotCached.pathARedirectCovers.median)
  // The slowest ours and the fastest theirs the rounding allows, so the figure never claims more than
  // the run measured.
  const timesFaster = Math.min(...most.map((_, index) => (theirs[index]! - ROUNDING) / (ours[index]! + ROUNDING)))

  if (timesFaster <= 1) throw new Error('redirects-comparison.json has findRedirect no faster than the example website')
  if (most.some((result) => result.theirsListCached.happensInNext)) {
    throw new Error(`redirects-comparison.json has a list of ${formatCount(MOST_REDIRECTS)} that Next's data cache holds`)
  }
  for (const result of most) {
    const { database } = result
    // The row: ours costs about the same at the most redirects as at the fewest, on each database.
    const oursAtFewest = findCaseOn(fewest, database).ours.pathARedirectCovers.median
    if (compareMedians(result.ours.pathARedirectCovers.median, oursAtFewest) > ABOUT_THE_SAME) {
      throw new Error(`redirects-comparison.json has findRedirect's cost change on ${DATABASE_LABELS[database]}`)
    }
  }
  for (const result of fewest) {
    // The caption: at the fewest redirects Next's data cache holds the list, and a lookup with it costs
    // well under a millisecond, close to ours on the same machine.
    const { pathARedirectCovers, happensInNext } = result.theirsListCached
    if (!happensInNext || pathARedirectCovers.median >= CLOSE_TO_OURS) {
      throw new Error(
        `redirects-comparison.json has the example website's cached lookup on ${DATABASE_LABELS[result.database]} not close to ours`
      )
    }
  }

  // Rounded down to two significant figures.
  const magnitude = 10 ** (Math.floor(Math.log10(timesFaster)) - 1)
  return {
    ours: formatRange(ours),
    theirs: formatRange(theirs),
    // What a lookup costs once a custom cache handler holds the list, which Next's own limit doesn't stop.
    theirsCached: formatRange(most.map((result) => result.theirsListCached.pathARedirectCovers.median)),
    theirsCachedAtFewest: formatRange(fewest.map((result) => result.theirsListCached.pathARedirectCovers.median)),
    timesFaster: `${formatCount(Math.floor(timesFaster / magnitude) * magnitude)}×`
  }
}
