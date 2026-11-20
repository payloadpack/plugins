import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import type { BranchMove } from '../path/move-branch.js'
import { isLocalized } from '../plugin/options.js'
import { setPathAndAncestorsBelowInMongodb } from './branch-mongodb.js'
import { lockBranchInPostgres, setPathAndAncestorsBelowInSql } from './branch-sql.js'

// The databases whose statements are SQL, which the site's sql builds.
export const usesSql = (database: string | undefined) => database === 'postgres' || database === 'sqlite'

// Holds the rows of a document's branch until the request ends, on Postgres only, where two saves in
// one branch can otherwise each hold a row the other waits for. Without a transaction a lock would end
// with its statement, so it takes none.
export async function lockBranch(collection: string, id: Id, req: PayloadRequest) {
  if (req.payload.db.name === 'postgres' && (await req.transactionID)) await lockBranchInPostgres({ collection, id }, req)
}

/**
 * Stores the paths and ancestors of the documents below a moved document, and of their latest
 * versions, with statements of the package's own: a few per move, whatever the size of the branch,
 * where Payload's database API writes one row at a time, whole. They replace only the start of a
 * path, in the rows that hang below the document when they run, and leave every other value of the
 * row as it was, updatedAt too. They run in the request's transaction, where the database has one.
 */
export async function setPathAndAncestorsBelow(move: BranchMove, req: PayloadRequest) {
  const { payload } = req
  const { paths } = move.starts
  // A collection that isn't localized holds one path for every locale, so one start serves them all.
  const starts = { ...move.starts, paths: isLocalized(move.collection, payload) ? paths : paths.slice(0, 1) }
  const setRowsBelow = usesSql(payload.db.name) ? setPathAndAncestorsBelowInSql : setPathAndAncestorsBelowInMongodb
  return setRowsBelow(move, starts, req)
}
