import EmbeddedPostgres from 'embedded-postgres'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'node:path'

import type { Database } from '../src/build-config.ts'
import { findFreePort } from './ports.ts'

type StartedDatabase = {
  buildRelayedUrl?: (relayPort: number) => string
  port?: number
  stop: () => Promise<void>
  url: string
}

const POSTGRES_PASSWORD = 'redirects-bench'

// A single-node replica set, as a site runs MongoDB for Payload's transactions.
async function startMongodb(): Promise<StartedDatabase> {
  const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const url = replicaSet.getUri('bench')
  const port = Number(new URL(url).port)
  return {
    // The relay stands in for the one node, so the driver connects to it directly, not as a replica set.
    buildRelayedUrl: (relayPort) => `mongodb://127.0.0.1:${relayPort}/bench?directConnection=true`,
    port,
    stop: async () => {
      await replicaSet.stop()
    },
    url
  }
}

async function startPostgres(directory: string): Promise<StartedDatabase> {
  const port = await findFreePort()
  const postgres = new EmbeddedPostgres({
    databaseDir: path.join(directory, 'postgres'),
    onLog: () => undefined,
    password: POSTGRES_PASSWORD,
    persistent: false,
    port,
    user: 'postgres'
  })
  await postgres.initialise()
  await postgres.start()
  await postgres.createDatabase('bench')
  const buildUrl = (urlPort: number) => `postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${urlPort}/bench`
  return { buildRelayedUrl: buildUrl, port, stop: () => postgres.stop(), url: buildUrl(port) }
}

export async function startDatabase(database: Database, directory: string): Promise<StartedDatabase> {
  if (database === 'mongodb') return startMongodb()
  if (database === 'postgres') return startPostgres(directory)
  return { stop: async () => undefined, url: `file:${path.join(directory, 'bench.db')}` }
}
