import type { Column, Name, SQL } from '@payloadcms/db-postgres/drizzle'
import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import type { StartsBelow } from '../path/starts-below.js'
import { getPathConfig } from '../plugin/options.js'

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
// collection, by the key of the column that holds an ancestor in a table of relationships. A
// collection with ancestors always has one, to itself.
function getTableName(ancestorColumnKey: string, { rawRelations }: SqlAdapter) {
  return Object.values(rawRelations).find((relations) => relations[ancestorColumnKey])![ancestorColumnKey]!.to
}

// What the statements and the lock start from: the site's sql, the adapter, a statement run in the
// request's transaction, the key of the column that holds an ancestor, the name of the documents'
// table, and the subquery of the rows below the document in a table of relationships: the ones that
// hold it among their ancestors at the field.
async function getStatementSetup(collection: string, id: Id, req: PayloadRequest) {
  const sql = getPathConfig(req.payload).sql as Sql
  const adapter = req.payload.db as unknown as SqlAdapter
  const db = adapter.sessions[String(await req.transactionID)]?.db ?? adapter.drizzle
  const ancestorColumnKey = `${collection}ID`
  return {
    adapter,
    ancestorColumnKey,
    documentsName: getTableName(ancestorColumnKey, adapter),
    execute: (statement: SQL) => adapter.execute({ db, sql: statement }),
    selectRowsBelow: (relationships: Record<string, Column>, ancestorsField: string) =>
      sql`SELECT ${relationships.parent} FROM ${relationships}
        WHERE ${relationships.path} = ${ancestorsField} AND ${relationships[ancestorColumnKey]} = ${id}`,
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
export async function lockBranchInPostgres(collection: string, id: Id, req: PayloadRequest) {
  const { adapter, documentsName, execute, selectRowsBelow, sql } = await getStatementSetup(collection, id, req)
  const documents = adapter.tables[documentsName]
  const relationships = adapter.tables[`${documentsName}${adapter.relationshipsSuffix}`]
  const ancestorCount = sql`(SELECT count(*) FROM ${relationships}
    WHERE ${relationships.parent} = ${documents.id} AND ${relationships.path} || '' = ${'ancestors'})`
  await execute(sql`SELECT ${documents.id} FROM ${documents}
    WHERE ${documents.id} = ANY(array_append(ARRAY(${selectRowsBelow(relationships, 'ancestors')}), ${id}))
    ORDER BY ${ancestorCount} FOR NO KEY UPDATE`)
}

/**
 * The statements on Postgres and SQLite, for the documents below or for their latest versions: an
 * update of the path column per locale whose start changes in a localized collection, where each
 * locale's path is a row of its own, one of the parent column, and up to three for the ancestors,
 * which are rows of their own in the table of relationships. Every value is bound. The database
 * counts the characters of the start itself, because a Postgres database of bytes counts a character
 * by its bytes.
 */
export async function buildStatementsBelowInSql(collection: string, id: Id, localized: boolean, req: PayloadRequest) {
  const { adapter, ancestorColumnKey, documentsName, execute, selectRowsBelow, sql } = await getStatementSetup(
    collection,
    id,
    req
  )
  const { localesSuffix, relationshipsSuffix, tables, versionsSuffix } = adapter
  // Postgres can't tell the type of a value it selects, so each is cast to the type of its column.
  const buildCast = (column: Column, value: unknown) => sql`CAST(${value} AS ${sql.raw(column.getSQLType())})`
  return (rowKind: 'documents' | 'versions') => {
    // The table of the documents or of their versions, with its table of relationships, the key a
    // column the statements write has there, the field the ancestors are rows of, and the rows below
    // there: of the versions the latest only.
    const isDocuments = rowKind === 'documents'
    const tableName = isDocuments ? documentsName : `_${documentsName}${versionsSuffix}`
    const rowsTable = tables[tableName]
    const relationships = tables[`${tableName}${relationshipsSuffix}`]
    const getRowColumnKey = (field: string) => (isDocuments ? field : `version_${field}`)
    const ancestorsField = isDocuments ? 'ancestors' : 'version.ancestors'
    const rowIdsBelow = isDocuments
      ? selectRowsBelow(relationships, ancestorsField)
      : sql`SELECT ${rowsTable.id} FROM ${rowsTable}
          WHERE ${rowsTable.latest} = ${true} AND ${rowsTable.id} IN (${selectRowsBelow(relationships, ancestorsField)})`
    // Postgres takes the column an update sets by its name alone, without its table, so each SET names
    // its column with sql.identifier.
    return {
      // A row's ancestors are rows of the table of relationships, in the order of a number each holds.
      // So the old ones move back to make room at the front for the new ones, and then the old ones up
      // to the first time the moved document comes after the new ones go, as
      // buildReplacedPathAndAncestors has it.
      setAncestors: async (ancestors: Id[]) => {
        const { order, parent, path } = relationships
        const ancestor = relationships[ancestorColumnKey]
        const newAncestorCount = ancestors.length
        // On Postgres ANY(ARRAY(…)) finds the rows below once instead of joining the table to itself.
        const isRowBelow = req.payload.db.name === 'postgres' ? sql`= ANY(ARRAY(${rowIdsBelow}))` : sql`IN (${rowIdsBelow})`
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
            WHERE ${rowsTable.id} IN (${rowIdsBelow})`)
        }
        // A join finds the moved document once for each row, where a subquery would look for it again
        // for each of the row's ancestors. The shift moved every order past what Postgres knows of the
        // table, so it would reach the old rows by their order or path once for each row below: + 0 and
        // || '' leave it only the row to reach them by.
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
      },
      setLiftedParent: async (parentField: string, liftParentId: Id | null) => {
        const parentColumn = rowsTable[getRowColumnKey(parentField)]
        await execute(sql`UPDATE ${rowsTable} SET ${sql.identifier(parentColumn.name)} = ${liftParentId}
          WHERE ${rowsTable.id} IN (${rowIdsBelow}) AND ${parentColumn} = ${id}`)
      },
      setPathStarts: async (paths: StartsBelow['paths']) => {
        const pathTable = tables[localized ? `${tableName}${localesSuffix}` : tableName]
        const pathColumn = pathTable[getRowColumnKey('path')]
        const rowId = localized ? pathTable._parentID : pathTable.id
        for (const { locale, newStart, oldStart } of paths) {
          const oldStartAndSlash = `${oldStart}/`
          const localeCondition = localized ? sql` AND ${pathTable._locale} = ${locale}` : sql``
          await execute(sql`UPDATE ${pathTable}
            SET ${sql.identifier(pathColumn.name)} = ${newStart} || substr(${pathColumn}, length(${oldStartAndSlash}))
            WHERE ${rowId} IN (${rowIdsBelow})${localeCondition}
            AND substr(${pathColumn}, 1, length(${oldStartAndSlash})) = ${oldStartAndSlash}`)
        }
      }
    }
  }
}
