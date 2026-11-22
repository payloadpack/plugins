import report from '../../data/redirects-speed.json'

// The numbers of the last full run of `bun run bench` in apps/redirects-bench, which writes
// redirects-speed.json.
export { report }

export const DATABASE_LABELS: Record<string, string> = { mongodb: 'MongoDB', postgres: 'Postgres', sqlite: 'SQLite' }

export const formatCount = (count: number) => count.toLocaleString('en')
