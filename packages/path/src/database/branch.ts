import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import { setPathAndAncestorsFieldsInMongodb } from './branch-mongodb.js'
import { lockBranchInPostgres, setPathAndAncestorsFieldsInSql } from './branch-sql.js'

// The rows a move writes: a collection's documents, or their versions.
export type RowKind = 'documents' | 'versions'

// A row by its id, with the fields it stores a path and ancestors in, each with the value it gets.
export type RowFields = { fields: Record<string, unknown>; id: Id }

// The databases whose statements are SQL, which the site's sql builds.
export const usesSql = (database: string | undefined) => database === 'postgres' || database === 'sqlite'

// Holds the rows of a document's branch until the request ends, on Postgres only, where two saves in
// one branch can otherwise each hold a row the other waits for. Without a transaction a lock would end
// with its statement, so it takes none.
export async function lockBranch(collection: string, id: Id, req: PayloadRequest) {
  if (req.payload.db.name === 'postgres' && (await req.transactionID)) await lockBranchInPostgres(collection, id, req)
}

/**
 * Stores the path and ancestors of many rows at once, with statements of the package's own: a few,
 * whatever the number of rows, where Payload's database API writes one row at a time, whole. They
 * write only the fields given for a row and leave every other value of it as it was, updatedAt too.
 * They run in the request's transaction, where the database has one.
 */
export async function setPathAndAncestorsFields(collection: string, kind: RowKind, rows: RowFields[], req: PayloadRequest) {
  if (rows.length === 0) return
  const setFields = usesSql(req.payload.db.name) ? setPathAndAncestorsFieldsInSql : setPathAndAncestorsFieldsInMongodb
  await setFields(collection, kind, rows, req)
}
