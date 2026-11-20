import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { sql as postgresSql } from '@payloadcms/db-postgres/drizzle'
import type { SQLiteAdapter } from '@payloadcms/db-sqlite'
import { sql as sqliteSql } from '@payloadcms/db-sqlite/drizzle'
import type { Payload, PayloadRequest } from 'payload'
import { onTestFinished } from 'vitest'

import { ADAPTER_SQL, type Query } from './adapters.js'
import type { TestPayload } from './boot-payload.js'
import type { Setup } from './setups.js'

// Payload types payload.db as the adapter of any database, and each test's setup says which one it is.
const mongodbOf = (payload: Payload) => (payload.db as unknown as MongooseAdapter).connection.getClient().db()
const postgresOf = (payload: Payload) => payload.db as unknown as PostgresAdapter
const sqliteOf = (payload: Payload) => payload.db as unknown as SQLiteAdapter

// MongoDB keeps an id as an ObjectId or as the number or text a site chose, and a test knows it as
// text, so a field is compared to an id as text.
const fieldHoldsId = (field: string, id: number | string) => ({ $eq: [{ $toString: `$${field}` }, String(id)] })

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

// A write the database refuses: of one path, in a collection or its versions, of other ancestors than
// a document stores, or of one document's row.
type RefusedWrite =
  | { collection: string; path: string; versions: boolean }
  | { ancestorsOf: number | string; collection: string }
  | { collection: string; id: number | string }

/**
 * Makes the database itself refuse a write while the work runs, so an operation fails at that write
 * the way it would on a real database error. A write of a refused document's row fails at its first
 * statement, so without a transaction it keeps every value it had, where a refused path on Postgres
 * and SQLite in a localized setup fails after the write took away the row's values of each locale. A
 * statement that changes a table takes no bound value, so the value is written into it, escaped by
 * drizzle.
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
    // Every other document, and this one while it keeps the ancestors it stores now.
    const keepsAncestors = async (id: number | string) => {
      const isDocument = fieldHoldsId('_id', id)
      const { ancestors } = (await db.collection(name).findOne({ $expr: isDocument }))!
      return { $or: [{ $expr: { $not: [isDocument] } }, { ancestors: { $eq: ancestors } }] }
    }
    const validator =
      'path' in refused
        ? { [`${versions ? 'version.' : ''}path${setup.localized ? '.en' : ''}`]: { $ne: refused.path } }
        : 'ancestorsOf' in refused
          ? await keepsAncestors(refused.ancestorsOf)
          : { $expr: { $not: [fieldHoldsId('_id', refused.id)] } }
    await db.command({ collMod: name, validator })
    try {
      return await work()
    } finally {
      await db.command({ collMod: name, validator: {} })
    }
  }
  // A document's ancestors are rows of the collection's table of relationships that name it as their
  // parent, so a write of any of them is refused.
  const [tableName, columnName, value] =
    'path' in refused
      ? [
          `${versions ? `_${collection}_v` : collection}${setup.localized ? '_locales' : ''}`,
          versions ? 'version_path' : 'path',
          refused.path
        ]
      : 'ancestorsOf' in refused
        ? [`${collection}_rels`, 'parent_id', refused.ancestorsOf]
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

/**
 * The parent and the ancestors of a document and of its latest version, as the database stores them,
 * in a collection with the plugin's own parent field: on MongoDB the ObjectIds, numbers or text of the
 * row, and on Postgres and SQLite the parent's column and the rows of the relationships table,
 * top-down, in the type of their columns.
 */
export async function readStoredParentAndAncestors(
  { payload }: TestPayload,
  setup: Setup,
  collection: string,
  id: number | string
) {
  if (setup.database === 'mongodb') {
    const db = mongodbOf(payload)
    const document = await db.collection(collection).findOne({ $expr: fieldHoldsId('_id', id) })
    const version = await db.collection(`_${collection}_versions`).findOne({ $expr: fieldHoldsId('parent', id), latest: true })
    return {
      document: { ancestors: document?.ancestors, parent: document?.parent },
      version: { ancestors: version?.version.ancestors, parent: version?.version.parent }
    }
  }
  const { tables } = postgresOf(payload)
  const [rows, rels, versions, versionRels] = [collection, `${collection}_rels`, `_${collection}_v`, `_${collection}_v_rels`].map(
    (name) => tables[name]!
  )
  const idKey = `${collection}ID`
  // The same statements on both, each in the drizzle its adapter brings.
  const sql = ADAPTER_SQL[setup.database] as typeof postgresSql
  const latestVersionId = sql`SELECT ${versions.id} FROM ${versions} WHERE ${versions.parent} = ${id} AND ${versions.latest} = ${true}`
  const readIds = async (statement: ReturnType<typeof postgresSql>) =>
    setup.database === 'postgres'
      ? (await postgresOf(payload).drizzle.execute<{ id: unknown }>(statement)).rows.map((row) => row.id)
      : (await sqliteOf(payload).drizzle.all<{ id: unknown }>(statement as unknown as ReturnType<typeof sqliteSql>)).map(
          (row) => row.id
        )
  return {
    document: {
      ancestors: await readIds(
        sql`SELECT ${rels[idKey]} AS id FROM ${rels} WHERE ${rels.parent} = ${id} AND ${rels.path} = ${'ancestors'} ORDER BY ${rels.order}`
      ),
      parent: (await readIds(sql`SELECT ${rows.parent} AS id FROM ${rows} WHERE ${rows.id} = ${id}`))[0]
    },
    version: {
      ancestors: await readIds(
        sql`SELECT ${versionRels[idKey]} AS id FROM ${versionRels}
          WHERE ${versionRels.path} = ${'version.ancestors'} AND ${versionRels.parent} IN (${latestVersionId})
          ORDER BY ${versionRels.order}`
      ),
      parent: (
        await readIds(sql`SELECT ${versions.version_parent} AS id FROM ${versions} WHERE ${versions.id} IN (${latestVersionId})`)
      )[0]
    }
  }
}

const setOnMongodb = (payload: Payload, collection: string, id: number | string, values: Record<string, unknown>) =>
  mongodbOf(payload)
    .collection(collection)
    .updateOne({ $expr: fieldHoldsId('_id', id) }, { $set: values })

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
 * Locks a document's row of a collection on Postgres in a transaction with a lock clause, such as FOR
 * NO KEY UPDATE, and in a localized setup its row of English in the table of locales too, the rows
 * holdRow holds and isRowFree tries.
 */
async function lockRows(
  payload: Payload,
  { localized }: Setup,
  tx: Pick<PostgresAdapter['drizzle'], 'execute'>,
  collection: string,
  id: number | string,
  lockClause: string
) {
  const { tables } = postgresOf(payload)
  const lock = postgresSql.raw(lockClause)
  await tx.execute(postgresSql`SELECT id FROM ${tables[collection]} WHERE id = ${id} ${lock}`)
  if (localized) {
    await tx.execute(
      postgresSql`SELECT id FROM ${tables[`${collection}_locales`]} WHERE _parent_id = ${id} AND _locale = 'en' ${lock}`
    )
  }
}

/**
 * Holds a document's row of a collection on Postgres in a transaction of its own, so a write of it
 * waits, until the returned function lets it go. In a localized setup it holds the document's row of
 * English in the collection's table of locales too, which is where a move's statement writes the path
 * of a localized collection. A write of a row that names it as its parent doesn't wait.
 *
 * Given a saved title, it stands for a save in a transaction of its own that holds the row while a
 * move or a backfill reads it: as it lets go it gives the row that title, in English in a localized
 * setup, and a new updatedAt, and commits. The clock's time, not the transaction's start, so the new
 * updatedAt is later than any the row was read with.
 */
export async function holdRow(
  payload: Payload,
  setup: Setup,
  collection: string,
  id: number | string,
  { savedTitle }: { savedTitle?: string } = {}
) {
  const { drizzle, tables } = postgresOf(payload)
  const [row, locales] = [tables[collection], tables[`${collection}_locales`]]
  let letGo = () => {}
  const lettingGo = new Promise<void>((resolve) => (letGo = resolve))
  let held = () => {}
  const holding = new Promise<void>((resolve) => (held = resolve))
  const transaction = drizzle.transaction(async (tx) => {
    await lockRows(payload, setup, tx, collection, id, 'FOR NO KEY UPDATE')
    held()
    await lettingGo
    if (savedTitle === undefined) return
    await tx.execute(postgresSql`UPDATE ${row} SET updated_at = clock_timestamp() WHERE id = ${id}`)
    await tx.execute(
      setup.localized
        ? postgresSql`UPDATE ${locales} SET title = ${savedTitle} WHERE _parent_id = ${id} AND _locale = 'en'`
        : postgresSql`UPDATE ${row} SET title = ${savedTitle} WHERE id = ${id}`
    )
  })
  await holding
  const letGoAndCommit = async () => {
    letGo()
    await transaction
  }
  // A test that fails before it lets the row go would leave it held, and the write that waits for it
  // would never end.
  onTestFinished(letGoAndCommit)
  return letGoAndCommit
}

/**
 * Whether another connection can lock a document's row of a collection on Postgres at once, in the
 * given mode, and in a localized setup its row of English in the table of locales too, as holdRow
 * holds them. It lets the locks go before it returns.
 */
export async function isRowFree(
  payload: Payload,
  setup: Setup,
  collection: string,
  id: number | string,
  mode: 'KEY SHARE' | 'NO KEY UPDATE'
) {
  try {
    await postgresOf(payload).drizzle.transaction((tx) => lockRows(payload, setup, tx, collection, id, `FOR ${mode} NOWAIT`))
    return true
  } catch (error) {
    // Postgres refuses a lock NOWAIT can't take at once with lock_not_available.
    if ((error as { cause?: { code?: string } }).cause?.code === '55P03') return false
    throw error
  }
}

// Whether a statement of this Postgres database waits for a row another transaction holds within 10
// seconds, so work that doesn't wait doesn't hang the test. A test asserts it only after it let the
// row go, so a failed assertion never leaves the row held.
export async function waitForRowWait(payload: Payload) {
  const { drizzle, schemaName } = postgresOf(payload)
  for (const started = Date.now(); Date.now() - started < 10_000;) {
    const { rows } = await drizzle.execute<{ waiting: number }>(
      postgresSql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE ${`%${schemaName}%`}`
    )
    if (rows[0]!.waiting > 0) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}
