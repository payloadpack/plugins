import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { SQLiteAdapter } from '@payloadcms/db-sqlite'
import EmbeddedPostgres from 'embedded-postgres'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'node:path'
import type { Payload } from 'payload'

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

export async function readDatabaseVersion(database: Database, payload: Payload) {
  if (database === 'mongodb') {
    return String((await (payload.db as unknown as MongooseAdapter).connection.db!.admin().buildInfo()).version)
  }
  if (database === 'postgres') {
    const { rows } = await (payload.db as unknown as PostgresAdapter).pool.query<{ server_version: string }>(
      'show server_version'
    )
    return rows[0]!.server_version
  }
  const { rows } = await (payload.db as unknown as SQLiteAdapter).client.execute('select sqlite_version() as version')
  return String(rows[0]!.version)
}

/**
 * Waits for the indexes MongoDB builds after Payload connects, and checks the ones a lookup reads
 * are there, by collection.
 */
export async function waitForMongodbIndexes(payload: Payload, readIndexes: Record<string, string[]>) {
  const adapter = payload.db as unknown as MongooseAdapter
  await Promise.all([...Object.values(adapter.collections), ...Object.values(adapter.versions)].map((model) => model.init()))
  for (const [collection, names] of Object.entries(readIndexes)) {
    const indexes = (await adapter.collections[collection]!.collection.indexes()).map(({ name }) => name)
    for (const index of names) {
      if (!indexes.includes(index)) {
        throw new Error(`MongoDB has no ${index} index on ${collection}, only ${indexes.join(', ')}`)
      }
    }
  }
}
