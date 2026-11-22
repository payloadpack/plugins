import type { WinOverDocuments } from '@payloadpack/redirects'

import { buildBenchConfig, DATABASES, type Database } from './build-config.ts'

// The plugin checks BENCH_WIN_OVER_DOCUMENTS itself.
const database = process.env.BENCH_DATABASE as Database | undefined
const url = process.env.DATABASE_URI
const winOverDocuments = process.env.BENCH_WIN_OVER_DOCUMENTS as undefined | WinOverDocuments

if (!database || !DATABASES.includes(database) || !url) {
  throw new Error(`Start the app with BENCH_DATABASE set to one of ${DATABASES.join(', ')}, and DATABASE_URI.`)
}

export default buildBenchConfig({ database, url, winOverDocuments })
