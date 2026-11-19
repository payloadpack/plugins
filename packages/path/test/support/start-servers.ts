import EmbeddedPostgres from 'embedded-postgres'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

import { TESTED_DATABASES, type DatabaseName } from './setups.js'

// Where each started server is: a connection URL, or for SQLite the directory its files go in.
type Servers = Partial<Record<DatabaseName, string>>

declare module 'vitest' {
  export interface ProvidedContext {
    servers: Servers
  }
}

const POSTGRES_PASSWORD = 'path-tests'

const findFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer().listen(0, () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port'))))
    })
  })

/**
 * Vitest's global setup: one server of each database under test for every test file, and none of
 * the others. Each file's Payload instances take their own database on it.
 */
export default async function startServers(project: TestProject) {
  const directory = await mkdtemp(path.join(tmpdir(), 'payloadpack-path-'))
  const servers: Servers = {}
  const stops: (() => Promise<unknown>)[] = []
  if (TESTED_DATABASES.includes('mongodb')) {
    // A single-node replica set, because the tests run with transactions too, which MongoDB has only there.
    const mongodb = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
    servers.mongodb = mongodb.getUri()
    stops.push(() => mongodb.stop())
  }
  if (TESTED_DATABASES.includes('postgres')) {
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
    await postgres.createDatabase('path')
    servers.postgres = `postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${port}/path`
    stops.push(() => postgres.stop())
  }
  if (TESTED_DATABASES.includes('sqlite')) servers.sqlite = directory
  project.provide('servers', servers)
  return async () => {
    for (const stop of stops) await stop()
    await rm(directory, { force: true, recursive: true })
  }
}
