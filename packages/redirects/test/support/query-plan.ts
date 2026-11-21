import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { sql as postgresSql } from '@payloadcms/db-postgres/drizzle'
import type { SQLiteAdapter } from '@payloadcms/db-sqlite'
import type { Payload } from 'payload'

import type { Query } from './adapters.js'

type PlanStage = { indexName?: string; inputStage?: PlanStage; inputStages?: PlanStage[]; stage: string }

type QueryPlan = {
  stages: string[]
  indexes: string[]
  keysExamined: number
  documentsExamined: number
  returned: number
}

const getStages = (stage: PlanStage): PlanStage[] => [
  stage,
  ...[...(stage.inputStage ? [stage.inputStage] : []), ...(stage.inputStages ?? [])].flatMap(getStages)
]

/** How MongoDB runs a find Payload sent, as it sent it: with Payload's access, fallback sort and limit. */
export async function findMongodbPlan(payload: Payload, { collection, command }: Query): Promise<QueryPlan> {
  if (!command) throw new Error('Only a MongoDB command is explained as a find.')
  const db = (payload.db as unknown as MongooseAdapter).connection.db!
  const { filter, limit, projection, sort } = command
  const explanation = await db.command({
    // MongoDB reads a command's name from its first key, so find comes first.
    explain: { find: collection, filter, projection, sort, ...(limit === undefined ? {} : { limit }) },
    verbosity: 'executionStats'
  })
  // MongoDB's slot-based engine nests the plan's stages one level down.
  const winningPlan = explanation.queryPlanner.winningPlan as PlanStage & { queryPlan?: PlanStage }
  const stages = getStages(winningPlan.queryPlan ?? winningPlan)
  const { nReturned, totalDocsExamined, totalKeysExamined } = explanation.executionStats
  return {
    documentsExamined: totalDocsExamined,
    indexes: [...new Set(stages.flatMap(({ indexName }) => (indexName ? [indexName] : [])))].sort(),
    keysExamined: totalKeysExamined,
    returned: nReturned,
    stages: stages.map(({ stage }) => stage)
  }
}

type SqliteStatement = Exclude<Parameters<SQLiteAdapter['client']['execute']>[0], string>

// Each line of the plan, such as SEARCH redirects USING INDEX .... Explained on the client's own
// connection, the plans leave a lock that fails a later save's commit with SQLITE_BUSY, so each runs in
// a read transaction, on a connection closing lets go of.
export async function findSqlitePlan(payload: Payload, { sql }: Query) {
  if (!sql) throw new Error('Only a SQL statement has a plan.')
  const explaining = await (payload.db as unknown as SQLiteAdapter).client.transaction('read')
  try {
    const { rows } = await explaining.execute({
      args: sql.params as SqliteStatement['args'],
      sql: `EXPLAIN QUERY PLAN ${sql.text}`
    })
    return rows.map(({ detail }) => String(detail))
  } finally {
    explaining.close()
  }
}

// Each as its table and columns, such as redirects(from).
export async function findPostgresIndexes(payload: Payload, table: string) {
  const { drizzle, schemaName } = payload.db as unknown as PostgresAdapter
  const { rows } = await drizzle.execute<{ definition: string }>(
    postgresSql`SELECT indexdef AS "definition" FROM pg_indexes WHERE schemaname = ${schemaName} AND tablename = ${table}`
  )
  return rows.map(({ definition }) => `${table}(${/\(([^()]*)\)\s*$/.exec(definition)![1]!.replace(/["\s]/g, '')})`)
}
