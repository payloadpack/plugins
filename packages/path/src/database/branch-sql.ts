import type { Column, SQL } from '@payloadcms/db-postgres/drizzle'
import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import { getParentFieldName, getPathConfig, isLocalized } from '../plugin/options.js'
import { getLocales } from '../utils/locales.js'
import type { RowFields, RowKind } from './branch.js'

// The sql of drizzle, which each of Payload's Postgres and SQLite adapters exports and the site gives
// the plugin, so the statements are built by the drizzle that runs them.
type Sql = typeof import('@payloadcms/db-postgres/drizzle').sql

// What the statements use of Payload's Postgres and SQLite adapters, which both have it: drizzle's
// tables by their names, each with its columns, the table each relationship of a table points at, and
// the session of each transaction.
type SqlAdapter = {
  drizzle: unknown
  execute: (args: { db: unknown; sql: SQL }) => Promise<unknown>
  localesSuffix: string
  rawRelations: Record<string, Record<string, { to: string } | undefined>>
  relationshipsSuffix: string
  schemaName?: string
  sessions: Record<string, { db: unknown } | undefined>
  tables: Record<string, Record<string, Column>>
  versionsSuffix: string
}

// What the statements and the lock start from: the site's sql, the adapter, a statement run in the
// request's transaction, and the table of the collection's documents, which the adapter keeps with
// every relationship to the collection. A collection with ancestors always has one, to itself.
async function getStatementSetup(collection: string, req: PayloadRequest) {
  const sql = getPathConfig(req.payload).sql as Sql
  const adapter = req.payload.db as unknown as SqlAdapter
  const db = adapter.sessions[String(await req.transactionID)]?.db ?? adapter.drizzle
  const toCollection = `${collection}ID`
  const documentsName = Object.values(adapter.rawRelations).find((relations) => relations[toCollection])![toCollection]!.to
  return { adapter, documentsName, execute: (statement: SQL) => adapter.execute({ db, sql: statement }), sql }
}

/**
 * Holds the document's row and every row below it until the transaction ends: its own row first, then
 * top-down by how many ancestors a row has, so a save that waits for a row holds none below it. FOR NO
 * KEY UPDATE lets another save's foreign key check of a held row through, where Payload's write would
 * not. ANY(ARRAY(…)) reaches the rows by their ids, where OR would read the whole table, and || ''
 * makes Postgres count a row's ancestors by the row, where a table it knows little of yet would have it
 * read every ancestor of the collection for each row.
 */
export async function lockBranchInPostgres(collection: string, id: Id, req: PayloadRequest) {
  const { adapter, documentsName, execute, sql } = await getStatementSetup(collection, req)
  const [documents, rels] = [adapter.tables[documentsName], adapter.tables[`${documentsName}${adapter.relationshipsSuffix}`]]
  const rowsBelow = sql`SELECT ${rels.parent} FROM ${rels} WHERE ${rels.path} = ${'ancestors'} AND ${rels[`${collection}ID`]} = ${id}`
  const ancestorCount = sql`(SELECT count(*) FROM ${rels}
    WHERE ${rels.parent} = ${documents.id} AND ${rels.path} || '' = ${'ancestors'})`
  await execute(sql`SELECT ${documents.id} FROM ${documents}
    WHERE ${documents.id} = ANY(array_append(ARRAY(${rowsBelow}), ${id}))
    ORDER BY ${ancestorCount} FOR NO KEY UPDATE`)
}

/**
 * The write on Postgres and SQLite: an update of the path column, one of the parent column for the
 * rows that get another parent, and a delete and an insert for the rows that get other ancestors,
 * which are rows of their own in the table of relationships. Each statement reads its rows out of one
 * bound value, a JSON list, so it binds the same whatever the number of rows.
 */
export async function setPathAndAncestorsFieldsInSql(collection: string, kind: RowKind, rows: RowFields[], req: PayloadRequest) {
  const { payload } = req
  const { adapter, documentsName, execute, sql } = await getStatementSetup(collection, req)
  const { localesSuffix, relationshipsSuffix, tables, versionsSuffix } = adapter
  const [tableName, columnPrefix, fieldPrefix] =
    kind === 'documents' ? [documentsName, '', ''] : [`_${documentsName}${versionsSuffix}`, 'version_', 'version.']
  const [rowsTable, relationships] = [tables[tableName], tables[`${tableName}${relationshipsSuffix}`]]
  // Each database reads a JSON list as rows with a column named value.
  const each = (list: unknown[]) =>
    payload.db.name === 'postgres'
      ? sql`jsonb_array_elements(CAST(${JSON.stringify(list)} AS jsonb))`
      : sql`json_each(${JSON.stringify(list)})`
  // A value of a JSON row is text, so it is cast to the type of the column it is compared with or
  // written to. The id of a row is of the type the table of relationships points at it with.
  const typeOf = (column: Column) => sql.raw(column.getSQLType())
  const idType = typeOf(relationships.parent)

  // A localized collection stores each locale's path in a row of its own, by the row and the locale.
  const localized = isLocalized(collection, payload)
  const pathTable = localized ? tables[`${tableName}${localesSuffix}`] : rowsTable
  const pathColumn = pathTable[`${columnPrefix}path`]
  const paths = rows.flatMap(({ fields, id }) =>
    localized
      ? getLocales(payload).map((locale) => ({ id, locale, path: (fields.path as Record<string, string>)[locale] ?? null }))
      : [{ id, path: fields.path }]
  )
  const writtenPaths = sql`(SELECT CAST(value ->> 'id' AS ${idType}) AS id, value ->> 'locale' AS locale, value ->> 'path' AS path
    FROM ${each(paths)}) AS written`
  const isRowOfPath = localized
    ? sql`${pathTable._parentID} = written.id AND CAST(${pathTable._locale} AS text) = written.locale`
    : sql`${pathTable.id} = written.id`
  await execute(
    sql`UPDATE ${pathTable} SET ${sql.identifier(pathColumn.name)} = written.path FROM ${writtenPaths} WHERE ${isRowOfPath}`
  )
  if (localized) {
    // A document has no row for a locale it has no values in, as one stored before the plugin has
    // none for a locale it only falls back in, so a path there gets a row. Postgres keeps the locales
    // in a type of the schema's own.
    const { _locale, _parentID } = pathTable
    const localeType = adapter.schemaName ? sql`${sql.identifier(adapter.schemaName)}.${typeOf(_locale)}` : typeOf(_locale)
    const columns = [pathColumn, _locale, _parentID].map(({ name }) => sql.identifier(name))
    await execute(sql`INSERT INTO ${pathTable} (${sql.join(columns, sql`, `)})
      SELECT written.path, CAST(written.locale AS ${localeType}), written.id FROM ${writtenPaths}
      WHERE written.path IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${pathTable} WHERE ${isRowOfPath})`)
  }

  const parentField = getParentFieldName(collection, payload)
  const parents = rows.flatMap(({ fields, id }) =>
    parentField !== undefined && parentField in fields ? [{ id, parent: fields[parentField] }] : []
  )
  if (parents.length > 0) {
    const parentColumn = rowsTable[`${columnPrefix}${parentField}`]
    await execute(sql`UPDATE ${rowsTable} SET ${sql.identifier(parentColumn.name)} = written.parent
      FROM (SELECT CAST(value ->> 'id' AS ${idType}) AS id, CAST(value ->> 'parent' AS ${typeOf(parentColumn)}) AS parent
        FROM ${each(parents)}) AS written
      WHERE ${rowsTable.id} = written.id`)
  }

  const rowsWithAncestors = rows.filter(({ fields }) => 'ancestors' in fields)
  if (rowsWithAncestors.length === 0) return
  const { order, parent, path } = relationships
  const ancestor = relationships[`${collection}ID`]
  const ancestorsField = `${fieldPrefix}ancestors`
  await execute(sql`DELETE FROM ${relationships} WHERE ${path} = ${ancestorsField}
    AND ${parent} IN (SELECT CAST(value ->> 'id' AS ${idType}) FROM ${each(rowsWithAncestors.map(({ id }) => ({ id })))})`)
  const ancestors = rowsWithAncestors.flatMap(({ fields, id }) =>
    (fields.ancestors as Id[]).map((ancestorId, index) => ({ ancestor: ancestorId, id, order: index + 1 }))
  )
  if (ancestors.length === 0) return
  const columns = [order, parent, path, ancestor].map(({ name }) => sql.identifier(name))
  await execute(sql`INSERT INTO ${relationships} (${sql.join(columns, sql`, `)})
    SELECT CAST(value ->> 'order' AS ${typeOf(order)}), CAST(value ->> 'id' AS ${idType}), ${ancestorsField},
      CAST(value ->> 'ancestor' AS ${typeOf(ancestor)})
    FROM ${each(ancestors)}`)
}
