import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import path from 'node:path'
import { inject } from 'vitest'

import type { DatabaseName } from './setups.js'

/**
 * A query the database ran: a data command MongoDB ran, as the driver sent it, or a statement Postgres
 * or SQLite ran, with its text and values, so a test can count them and explain one. On Postgres and
 * SQLite its collection is the table the statement names outside its subqueries, such as
 * redirects_rels.
 */
export type Query = {
  collection: string
  command?: Record<string, unknown>
  operation: string
  sql?: { params: unknown[]; text: string }
}

const MONGODB_DATA_COMMANDS = ['aggregate', 'count', 'delete', 'find', 'findAndModify', 'getMore', 'insert', 'update']

// Only the text outside parentheses, where subqueries name tables of their own.
function getStatementTable(text: string) {
  let depth = 0
  let topLevel = ''
  for (const character of text) {
    if (character === '(') {
      depth++
      continue
    }
    if (character === ')') {
      depth--
      continue
    }
    if (depth === 0) topLevel += character
  }
  const [, table = ''] = /(?:from|into|update)\s+(?:["`][^"`]+["`]\.)?["`]?(\w+)["`]?/i.exec(topLevel) ?? []
  return table
}

export function recordQueries() {
  let recording: Query[] | undefined
  return {
    listQueries: async (work: () => Promise<unknown>) => {
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

function getServer(database: DatabaseName) {
  const server = inject('servers')[database]
  if (!server) throw new Error(`The global setup started no ${database}, which REDIRECTS_TEST_DATABASES leaves out.`)
  return server
}

export function buildAdapter(database: DatabaseName, name: string, record: (query: Query) => void, transactions: boolean) {
  if (database === 'mongodb') {
    const [base, query] = getServer(database).split('/?')
    return mongooseAdapter({
      afterOpenConnection: async (adapter) => {
        const client = adapter.connection.getClient()
        client.on('commandStarted', ({ command, commandName }) => {
          if (MONGODB_DATA_COMMANDS.includes(commandName)) {
            record({ collection: String(command[commandName]), command, operation: commandName })
          }
        })
        // MongoDB refuses a transaction that writes to a collection whose index mongoose still builds,
        // and Payload's ensureIndexes doesn't wait for those builds.
        const models = [...Object.values(adapter.collections), ...Object.values(adapter.versions)]
        await Promise.all(models.map((model) => model.init()))
      },
      connectOptions: { monitorCommands: true },
      ensureIndexes: true,
      url: transactions ? `${base}/${name}?${query}` : `${base}/${name}`
    })
  }
  const logger = {
    logQuery: (text: string, params: unknown[]) => {
      const [operation = ''] = text.trim().toLowerCase().split(/\s+/)
      record({ collection: getStatementTable(text), operation, sql: { params, text } })
    }
  }
  if (database === 'postgres') {
    return postgresAdapter({
      logger,
      pool: { connectionString: getServer(database) },
      push: true,
      schemaName: name,
      ...(transactions ? {} : { transactionOptions: false as const })
    })
  }
  // SQLite runs without transactions unless the adapter is given options for them.
  return sqliteAdapter({
    client: { url: `file:${path.join(getServer(database), `${name}.db`)}` },
    logger,
    push: true,
    ...(transactions ? { transactionOptions: {} } : {})
  })
}
