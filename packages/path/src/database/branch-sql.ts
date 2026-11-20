import type { Column, Name, SQL } from '@payloadcms/db-postgres/drizzle'
import type { CollectionSlug, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import type { BranchMove } from '../path/move-branch.js'
import type { StartsBelow } from '../path/starts-below.js'
import { getParentFieldName, getPathConfig, isLocalized } from '../plugin/options.js'

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
  sessions: Record<string, { db: unknown } | undefined>
  tables: Record<string, Record<string, Column>>
  versionsSuffix: string
}

// The table of a collection's documents, which the adapter keeps with every relationship to the
// collection. A collection with ancestors always has one, to itself.
function getTableName(collection: string, { rawRelations }: SqlAdapter) {
  const toCollection = `${collection}ID`
  return Object.values(rawRelations).find((relations) => relations[toCollection])![toCollection]!.to
}

// What the statements and the lock start from: the site's sql, the adapter, a statement run in the
// request's transaction, the table of the documents, and the rows below the document.
async function getStatementSetup({ collection, id }: Pick<BranchMove, 'collection' | 'id'>, req: PayloadRequest) {
  const sql = getPathConfig(req.payload).sql as Sql
  const adapter = req.payload.db as unknown as SqlAdapter
  const db = adapter.sessions[String(await req.transactionID)]?.db ?? adapter.drizzle
  const documentsName = getTableName(collection, adapter)
  const rels = adapter.tables[`${documentsName}${adapter.relationshipsSuffix}`]
  return {
    adapter,
    documentsName,
    execute: (statement: SQL) => adapter.execute({ db, sql: statement }),
    rowsBelow: sql`SELECT ${rels.parent} FROM ${rels} WHERE ${rels.path} = ${'ancestors'} AND ${rels[`${collection}ID`]} = ${id}`,
    sql
  }
}

/**
 * Holds the document's row and every row below it until the transaction ends: its own row first, then
 * top-down by how many ancestors a row has, so a save that waits for a row holds none below it. FOR NO
 * KEY UPDATE lets another save's foreign key check of a held row through, where Payload's write would
 * not. ANY(ARRAY(…)) reaches the rows by their ids, where OR would read the whole table, and || ''
 * makes Postgres count a row's ancestors by the row, where a table it knows little of yet would have it
 * read every ancestor of the collection for each row.
 */
export async function lockBranchInPostgres(branch: Pick<BranchMove, 'collection' | 'id'>, req: PayloadRequest) {
  const { adapter, documentsName, execute, rowsBelow, sql } = await getStatementSetup(branch, req)
  const [documents, rels] = [adapter.tables[documentsName], adapter.tables[`${documentsName}${adapter.relationshipsSuffix}`]]
  const ancestorCount = sql`(SELECT count(*) FROM ${rels}
    WHERE ${rels.parent} = ${documents.id} AND ${rels.path} || '' = ${'ancestors'})`
  await execute(sql`SELECT ${documents.id} FROM ${documents}
    WHERE ${documents.id} = ANY(array_append(ARRAY(${rowsBelow}), ${branch.id}))
    ORDER BY ${ancestorCount} FOR NO KEY UPDATE`)
}

/**
 * The statements on Postgres and SQLite, for the documents below and then for their latest versions:
 * an update of the path column per locale whose start changes in a localized collection, where each
 * locale's path is a row of its own, one of the parent column, and up to three for the ancestors,
 * which are rows of their own in the table of relationships. Every value is bound. The database
 * counts the characters of the start itself, because a Postgres database of bytes counts a character
 * by its bytes.
 */
export async function setPathAndAncestorsBelowInSql(
  { collection, id }: Pick<BranchMove, 'collection' | 'id'>,
  { ancestors, liftedTo, paths }: StartsBelow,
  req: PayloadRequest
) {
  const { payload } = req
  const localized = isLocalized(collection, payload)
  const parentField = getParentFieldName(collection, payload)
  const { adapter, documentsName, execute, rowsBelow, sql } = await getStatementSetup({ collection, id }, req)
  const { localesSuffix, relationshipsSuffix, tables, versionsSuffix } = adapter
  // Postgres takes the column an update sets by its name alone, without its table.
  const setPathStarts = async (tableName: string, pathColumnKey: string, rowsBelow: SQL) => {
    const pathTable = tables[localized ? `${tableName}${localesSuffix}` : tableName]
    const [pathColumn, rowId] = [pathTable[pathColumnKey], localized ? pathTable._parentID : pathTable.id]
    for (const { from, locale, to } of paths) {
      const oldStart = `${from}/`
      const localeCondition = localized ? sql` AND ${pathTable._locale} = ${locale}` : sql``
      await execute(sql`UPDATE ${pathTable}
        SET ${sql.identifier(pathColumn.name)} = ${to} || substr(${pathColumn}, length(${oldStart}))
        WHERE ${rowId} IN (${rowsBelow})${localeCondition}
        AND substr(${pathColumn}, 1, length(${oldStart})) = ${oldStart}`)
    }
  }
  const setLiftedParent = async (tableName: string, parentColumnKey: string, rowsBelow: SQL) => {
    const rowsTable = tables[tableName]
    const parentColumn = rowsTable[parentColumnKey]
    await execute(sql`UPDATE ${rowsTable} SET ${sql.identifier(parentColumn.name)} = ${liftedTo}
      WHERE ${rowsTable.id} IN (${rowsBelow}) AND ${parentColumn} = ${id}`)
  }
  // Postgres can't tell the type of a value it selects, so each is cast to the type of its column.
  const buildCast = (column: Column, value: unknown) => sql`CAST(${value} AS ${sql.raw(column.getSQLType())})`
  // A row's ancestors are rows of the table of relationships, in the order of a number each holds. So
  // the old ones move back to make room at the front for the new ones, and then the old ones up to the
  // first time the moved document comes after the new ones go, as buildReplacedPathAndAncestors has it.
  const setAncestors = async (tableName: string, ancestorsField: string, rowsBelow: SQL) => {
    if (!ancestors) return
    const [rowsTable, relationships] = [tables[tableName], tables[`${tableName}${relationshipsSuffix}`]]
    const { order, parent, path } = relationships
    const ancestor = relationships[`${collection}ID`]
    const newAncestorCount = ancestors.length
    // On Postgres ANY(ARRAY(…)) finds the rows below once instead of joining the table to itself.
    const isRowBelow = payload.db.name === 'postgres' ? sql`= ANY(ARRAY(${rowsBelow}))` : sql`IN (${rowsBelow})`
    const isAncestorOfRowBelow = sql`${path} = ${ancestorsField} AND ${parent} ${isRowBelow}`
    if (newAncestorCount > 0) {
      await execute(sql`UPDATE ${relationships}
        SET ${sql.identifier(order.name)} = ${order} + ${newAncestorCount} WHERE ${isAncestorOfRowBelow}`)
      const newAncestors = ancestors.map(
        (newAncestor, index) => sql`(${buildCast(order, index + 1)}, ${buildCast(ancestor, newAncestor)})`
      )
      const columns = [order, parent, path, ancestor].map(({ name }) => sql.identifier(name))
      await execute(sql`INSERT INTO ${relationships} (${sql.join(columns, sql`, `)})
        SELECT added.column1, ${rowsTable.id}, ${ancestorsField}, added.column2
        FROM (VALUES ${sql.join(newAncestors, sql`, `)}) AS added, ${rowsTable}
        WHERE ${rowsTable.id} IN (${rowsBelow})`)
    }
    // A join finds the moved document once for each row, where a subquery would look for it again for
    // each of the row's ancestors. The shift moved every order past what Postgres knows of the table, so
    // it would reach the old rows by their order or path once for each row below: + 0 and || '' leave it
    // only the row to reach them by.
    const [oldAncestor, movedDocument] = [sql.identifier('old'), sql.identifier('moved')]
    const buildAliasedColumn = (alias: Name) => (column: Column) => sql`${alias}.${sql.identifier(column.name)}`
    const [oldAncestorColumn, movedDocumentColumn] = [buildAliasedColumn(oldAncestor), buildAliasedColumn(movedDocument)]
    await execute(sql`DELETE FROM ${relationships} WHERE ${relationships.id} IN (
      SELECT ${oldAncestorColumn(relationships.id)} FROM ${relationships} AS ${oldAncestor}
      JOIN (
        SELECT ${parent} AS ${sql.identifier(parent.name)}, min(${order}) AS ${sql.identifier(order.name)} FROM ${relationships}
        WHERE ${isAncestorOfRowBelow} AND ${ancestor} = ${id} AND ${order} > ${newAncestorCount}
        GROUP BY ${parent}
      ) AS ${movedDocument} ON ${movedDocumentColumn(parent)} = ${oldAncestorColumn(parent)}
      WHERE ${oldAncestorColumn(path)} || '' = ${ancestorsField}
        AND ${oldAncestorColumn(order)} + 0 > ${newAncestorCount}
        AND ${oldAncestorColumn(order)} + 0 <= ${movedDocumentColumn(order)}
    )`)
  }
  // The rows below are found by the moved document among their ancestors, which a lift takes out of
  // them, so the ancestors come last, after the paths and the parent.
  const setRowsBelow = async (tableName: string, columnPrefix: string, ancestorsField: string, rowsBelow: SQL) => {
    await setPathStarts(tableName, `${columnPrefix}path`, rowsBelow)
    if (liftedTo !== undefined && parentField !== undefined) {
      await setLiftedParent(tableName, `${columnPrefix}${parentField}`, rowsBelow)
    }
    await setAncestors(tableName, ancestorsField, rowsBelow)
  }
  await setRowsBelow(documentsName, '', 'ancestors', rowsBelow)
  if (!hasDraftsEnabled(payload.collections[collection as CollectionSlug].config)) return
  const versionsName = `_${documentsName}${versionsSuffix}`
  const [versions, versionRels] = [tables[versionsName], tables[`${versionsName}${relationshipsSuffix}`]]
  await setRowsBelow(
    versionsName,
    'version_',
    'version.ancestors',
    sql`SELECT ${versions.id} FROM ${versions}
      WHERE ${versions.latest} = ${true}
      AND ${versions.id} IN (
        SELECT ${versionRels.parent} FROM ${versionRels}
        WHERE ${versionRels.path} = ${'version.ancestors'} AND ${versionRels[`${collection}ID`]} = ${id}
      )`
  )
}
