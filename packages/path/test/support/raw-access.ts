import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { sql as postgresSql } from '@payloadcms/db-postgres/drizzle'
import type { SQLiteAdapter } from '@payloadcms/db-sqlite'
import { sql as sqliteSql } from '@payloadcms/db-sqlite/drizzle'
import type { Payload, PayloadRequest } from 'payload'

import type { Query } from './adapters.js'
import type { TestPayload } from './boot-payload.js'
import type { Setup } from './setups.js'

// Payload types payload.db as the adapter of any database, and each test's setup says which one it is.
const mongodbOf = (payload: Payload) => (payload.db as unknown as MongooseAdapter).connection.getClient().db()
const postgresOf = (payload: Payload) => payload.db as unknown as PostgresAdapter
const sqliteOf = (payload: Payload) => payload.db as unknown as SQLiteAdapter

type IndexRow = { definition: string; table: string }

function listSqlIndexes(payload: Payload, { database }: Setup): Promise<IndexRow[]> {
  if (database === 'postgres') {
    const { drizzle, schemaName } = postgresOf(payload)
    return drizzle
      .execute<IndexRow>(
        postgresSql`SELECT tablename AS "table", indexdef AS "definition" FROM pg_indexes WHERE schemaname = ${schemaName}`
      )
      .then(({ rows }) => rows)
  }
  return sqliteOf(payload).drizzle.all<IndexRow>(
    sqliteSql`SELECT tbl_name AS "table", sql AS "definition" FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL`
  )
}

/**
 * The indexes the database holds for a collection's tables, each as its table and columns, such as
 * pages_locales(path,_locale), or for MongoDB its collection and keys, such as pages(path.en).
 */
export async function listIndexes({ payload }: TestPayload, setup: Setup, collection: string) {
  if (setup.database === 'mongodb') {
    const indexes = await mongodbOf(payload).collection(collection).indexes()
    return indexes.map(({ key }) => `${collection}(${Object.keys(key).join(',')})`)
  }
  const rows = await listSqlIndexes(payload, setup)
  return rows
    .filter(({ table }) => table === collection || table.startsWith(`${collection}_`))
    .map(({ definition, table }) => `${table}(${/\(([^()]*)\)\s*$/.exec(definition)![1]!.replace(/["`\s]/g, '')})`)
}

type SqliteStatement = Exclude<Parameters<SQLiteAdapter['client']['execute']>[0], string>

/**
 * The plan SQLite makes for a statement it ran, as the steps EXPLAIN QUERY PLAN lists. SQLite keeps
 * no statistics unless a site runs ANALYZE, so the plan depends on the statement alone, whatever the
 * tables hold.
 */
export async function readSqlitePlan({ payload }: TestPayload, { sql }: Query) {
  if (!sql) throw new Error('Only a SQL statement has a plan.')
  const { rows } = await sqliteOf(payload).client.execute({
    args: sql.params as SqliteStatement['args'],
    sql: `EXPLAIN QUERY PLAN ${sql.text}`
  })
  return rows.map(({ detail }) => String(detail))
}

// A write the database refuses: of one path, in a collection or its versions, or of one document.
type RefusedWrite = { collection: string; path: string; versions: boolean } | { collection: string; id: number | string }

/**
 * Makes the database itself refuse a write while the work runs, so an operation fails at that write
 * the way it would on a real database error. A refused document fails at the first statement of its
 * write, so without a transaction it keeps every value it had. A statement that changes a table
 * takes no bound value, so the value is written into it, escaped by drizzle.
 */
export async function refuseWritesOf(
  { payload }: TestPayload,
  setup: Setup,
  refused: RefusedWrite,
  work: () => Promise<unknown>
) {
  const { collection } = refused
  const versions = 'path' in refused && refused.versions
  if (setup.database === 'mongodb') {
    const db = mongodbOf(payload)
    const name = versions ? `_${collection}_versions` : collection
    const validator =
      'path' in refused
        ? { [`${versions ? 'version.' : ''}path${setup.localized ? '.en' : ''}`]: { $ne: refused.path } }
        : { $expr: { $ne: [{ $toString: '$_id' }, String(refused.id)] } }
    await db.command({ collMod: name, validator })
    try {
      return await work()
    } finally {
      await db.command({ collMod: name, validator: {} })
    }
  }
  const [tableName, columnName, value] =
    'path' in refused
      ? [
          `${versions ? `_${collection}_v` : collection}${setup.localized ? '_locales' : ''}`,
          versions ? 'version_path' : 'path',
          refused.path
        ]
      : [collection, 'id', refused.id]
  if (setup.database === 'postgres') {
    const { drizzle, tables } = postgresOf(payload)
    const table = tables[tableName]!
    const constraint = postgresSql.identifier('refuse_write')
    // Not valid, so the row that is there already stays, and only a write of it is refused.
    await drizzle.execute(
      postgresSql`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (${postgresSql.identifier(columnName)} IS DISTINCT FROM ${value}) NOT VALID`.inlineParams()
    )
    try {
      return await work()
    } finally {
      await drizzle.execute(postgresSql`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`)
    }
  }
  const { drizzle, tables } = sqliteOf(payload)
  const table = tables[tableName]!
  const triggers = ['INSERT', 'UPDATE'].map((event) => ({
    event: sqliteSql.raw(event),
    name: sqliteSql.identifier(`refuse_write_${event.toLowerCase()}`)
  }))
  for (const { event, name } of triggers) {
    await drizzle.run(
      sqliteSql`CREATE TRIGGER ${name} BEFORE ${event} ON ${table} WHEN NEW.${sqliteSql.identifier(columnName)} = ${value} BEGIN SELECT RAISE(ABORT, 'refused'); END`.inlineParams()
    )
  }
  try {
    return await work()
  } finally {
    for (const { name } of triggers) await drizzle.run(sqliteSql`DROP TRIGGER ${name}`)
  }
}

// MongoDB keeps an id as an ObjectId or as the number or text a site chose, and a test knows it as text.
const setOnMongodb = (payload: Payload, collection: string, id: number | string, values: Record<string, unknown>) =>
  mongodbOf(payload)
    .collection(collection)
    .updateOne({ $expr: { $eq: [{ $toString: '$_id' }, String(id)] } }, { $set: values })

/**
 * Stores a row's updatedAt as text that Payload didn't write, as an import or another tool may: on
 * SQLite in another form than Payload's, and on MongoDB as a string where Payload keeps a date. The
 * value Payload reads back from such a row doesn't find the row in a where. Postgres keeps updatedAt
 * in a timestamp column, so there every value reads back as what finds it.
 */
export async function setUpdatedAtNotWrittenByPayload(payload: Payload, setup: Setup, collection: string, id: number | string) {
  const updatedAt = '2026-01-01 00:00:00'
  if (setup.database === 'mongodb') {
    await setOnMongodb(payload, collection, id, { updatedAt })
    return
  }
  if (setup.database !== 'sqlite') throw new Error('Only MongoDB and SQLite store an updatedAt Payload reads back otherwise.')
  const { drizzle, tables } = sqliteOf(payload)
  await drizzle.run(sqliteSql`UPDATE ${tables[collection]!} SET updated_at = ${updatedAt} WHERE id = ${id}`)
}

/**
 * Stores text that is no date as a row's createdAt and updatedAt on MongoDB, as an import or another
 * tool may. Payload reads such a row as it is and can save it, and the adapter refuses that text in a
 * write. Only MongoDB has such a row: Payload can't read one on SQLite, and Postgres keeps both in
 * timestamp columns.
 */
export const setTimestampsThatAreNoDates = (payload: Payload, collection: string, id: number | string) =>
  setOnMongodb(payload, collection, id, { createdAt: 'not a date', updatedAt: 'not a date' })

/**
 * Holds a collection's table on Postgres in the transaction of a request, as a migration that changes
 * the table does, until that transaction ends: every other connection waits for the table, and the
 * request's own doesn't.
 */
export async function holdTable(payload: Payload, collection: string, req: PayloadRequest) {
  const { sessions, tables } = postgresOf(payload)
  const { db } = sessions[String(await req.transactionID)]!
  await db.execute(postgresSql`LOCK TABLE ${tables[collection]} IN ACCESS EXCLUSIVE MODE`)
}

/**
 * Holds a row of a collection on Postgres in a transaction of its own, so a write of it waits, until
 * the returned function lets it go. A write of a row that names it as its parent doesn't wait.
 *
 * Given a title, it stands for a save in a transaction of its own that holds the row while a move or
 * a backfill reads it: as it lets go it gives the row that title, in English in a localized
 * collection, and a new updatedAt, and commits. The clock's time, not the transaction's start, so the
 * new updatedAt is later than any the row was read with.
 */
export async function holdRow(
  payload: Payload,
  collection: string,
  id: number | string,
  saved?: { localized: boolean; title: string }
) {
  const { drizzle, tables } = postgresOf(payload)
  let letGo = () => {}
  const lettingGo = new Promise<void>((resolve) => (letGo = resolve))
  let held = () => {}
  const holding = new Promise<void>((resolve) => (held = resolve))
  const transaction = drizzle.transaction(async (tx) => {
    await tx.execute(postgresSql`SELECT id FROM ${tables[collection]} WHERE id = ${id} FOR NO KEY UPDATE`)
    held()
    await lettingGo
    if (!saved) return
    const { localized, title } = saved
    await tx.execute(postgresSql`UPDATE ${tables[collection]} SET updated_at = clock_timestamp() WHERE id = ${id}`)
    await tx.execute(
      localized
        ? postgresSql`UPDATE ${tables[`${collection}_locales`]} SET title = ${title} WHERE _parent_id = ${id} AND _locale = 'en'`
        : postgresSql`UPDATE ${tables[collection]} SET title = ${title} WHERE id = ${id}`
    )
  })
  await holding
  return async () => {
    letGo()
    await transaction
  }
}

// Waits until a statement of this Postgres database waits for a row another transaction holds, or
// gives up after a while, so work that doesn't wait doesn't hang the test.
export async function waitForRowWait(payload: Payload) {
  const { drizzle, schemaName } = postgresOf(payload)
  for (const started = Date.now(); Date.now() - started < 10_000;) {
    const { rows } = await drizzle.execute<{ waiting: number }>(
      postgresSql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE ${`%${schemaName}%`}`
    )
    if (rows[0]!.waiting > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
