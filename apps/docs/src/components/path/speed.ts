import remoteServerRun from '../../data/path-remote-server.json'
import report from '../../data/path-speed.json'

// The numbers of the last run of `bun run bench` in packages/path, which writes path-speed.json.
export { report }

// Each way to build paths, timed against a MongoDB server on another machine, which `bun run bench` doesn't run.
export { remoteServerRun }

export type Setup = (typeof report.setups)[number]
export type Timing = { median: number; p95: number }

export const DATABASE_LABELS: Record<string, string> = { mongodb: 'MongoDB', postgres: 'Postgres', sqlite: 'SQLite' }

// The methods the comparison ran, in the order that gives each its color.
export const METHODS = report.methods.map(({ id }) => id)

export const methodLabel = (method: string) => report.methods.find(({ id }) => id === method)?.label ?? method

export const unlocalizedSetups = report.setups.filter(({ localized }) => !localized)

// Milliseconds as a reader takes them in: a decimal while small, seconds from 1,000 ms.
export function formatTime(milliseconds: number) {
  if (milliseconds >= 1_000) {
    const seconds = milliseconds / 1_000
    return `${seconds.toLocaleString('en', { maximumFractionDigits: seconds < 10 ? 1 : 0 })} s`
  }
  return `${milliseconds.toLocaleString('en', { maximumFractionDigits: milliseconds < 10 ? 1 : 0 })} ms`
}

export const formatTiming = ({ median, p95 }: Timing) => `${formatTime(median)} (p95 ${formatTime(p95)})`
