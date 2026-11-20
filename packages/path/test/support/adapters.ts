import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import path from 'node:path'
import { inject } from 'vitest'

import type { DatabaseName } from './setups.js'

// parallel marks a MongoDB command that started while another was running. The SQL adapters run one
// statement at a time on a connection.
export type Query = { collection: string; operation: string; parallel: boolean; sql?: { params: unknown[]; text: string } }

const MONGODB_DATA_COMMANDS = ['aggregate', 'count', 'delete', 'find', 'findAndModify', 'getMore', 'insert', 'update']

// Only the text outside parentheses, where subqueries name tables of their own.
function readTable(text: string) {
  let depth = 0
  let topLevel = ''
  for (const character of text) {
    if (character === '(') depth++
    else if (character === ')') depth--
    else if (depth === 0) topLevel += character
  }
  const [, table = ''] = /(?:from|into|update)\s+(?:["`][^"`]+["`]\.)?["`]?(\w+)["`]?/i.exec(topLevel) ?? []
  return table
}

export function recordQueries() {
  let recording: Query[] | undefined
  return {
    // Runs work and returns the statements the database ran meanwhile.
    countQueries: async (work: () => Promise<unknown>) => {
      recording = []
      try {
        await work()
        return recording
      } finally {
        recording = undefined
      }
    },
    record: (query: Query) => void recording?.push(query)
  }
}

type AdapterOptions = {
  // MongoDB only: each document of a bulk operation gets a transaction of its own.
  bulkOperationsSingleTransaction: boolean
  // Postgres and SQLite only: a uuid for the id of every collection without an id field of its own.
  idType?: 'uuid'
  transactions: boolean
}

function findServer(database: DatabaseName) {
  const server = inject('servers')[database]
  if (!server) throw new Error(`The global setup started no ${database}, which PATH_TEST_DATABASES leaves out.`)
  return server
}

export function buildAdapter(
  database: DatabaseName,
  name: string,
  record: (query: Query) => void,
  { bulkOperationsSingleTransaction, idType, transactions }: AdapterOptions
) {
  if (database === 'mongodb') {
    const [base, query] = findServer(database).split('/?')
    const url = transactions ? `${base}/${name}?${query}` : `${base}/${name}`
    const running = new Set<number>()
    return mongooseAdapter({
      afterOpenConnection: async (adapter) => {
        const client = adapter.connection.getClient()
        client.on('commandStarted', ({ command, commandName, requestId }) => {
          if (!MONGODB_DATA_COMMANDS.includes(commandName)) return
          const parallel = running.size > 0
          running.add(requestId)
          record({ collection: String(command[commandName]), operation: commandName, parallel })
        })
        client.on('commandSucceeded', ({ requestId }) => running.delete(requestId))
        client.on('commandFailed', ({ requestId }) => running.delete(requestId))
        // mongoose builds every index itself once the connection opens, and Payload's ensureIndexes
        // asks for each one again and waits for its own commands only. So one of mongoose's can still
        // wait for a collection's lock when Payload has started, and MongoDB then refuses a transaction
        // that writes to that collection. A model's init ends when mongoose has built its indexes.
        const models = [...Object.values(adapter.collections), ...Object.values(adapter.versions)]
        await Promise.all(models.map((model) => model.init()))
      },
      bulkOperationsSingleTransaction,
      connectOptions: { monitorCommands: true },
      // Collections and indexes exist before the first transaction, which can't create them.
      ensureIndexes: true,
      url
    })
  }
  const logger = {
    logQuery: (text: string, params: unknown[]) => {
      const [operation = ''] = text.trim().toLowerCase().split(/\s+/)
      record({ collection: readTable(text), operation, parallel: false, sql: { params, text } })
    }
  }
  if (database === 'postgres') {
    return postgresAdapter({
      idType,
      logger,
      pool: { connectionString: findServer(database) },
      push: true,
      schemaName: name,
      ...(transactions ? {} : { transactionOptions: false as const })
    })
  }
  return sqliteAdapter({
    client: { url: `file:${path.join(findServer(database), `${name}.db`)}` },
    idType,
    logger,
    push: true,
    ...(transactions ? { transactionOptions: {} } : {})
  })
}
