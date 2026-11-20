import type { CollectionSlug, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import type { Id } from '../path/build-path-and-ancestors.js'
import type { StartsBelow } from '../path/starts-below.js'
import { getParentFieldName, isLocalized } from '../plugin/options.js'
import { buildStatementsBelowInMongodb } from './branch-mongodb.js'
import { buildStatementsBelowInSql, lockBranchInPostgres } from './branch-sql.js'

// The databases whose statements are SQL, which the site's sql builds.
export const usesSql = (database: string | undefined) => database === 'postgres' || database === 'sqlite'

// Holds the rows of a document's branch until the request ends, on Postgres only, where two saves in
// one branch can otherwise each hold a row the other waits for, and says whether it did. Without a
// transaction a lock would end with its statement, so it takes none.
export async function lockBranch(collection: string, id: Id, req: PayloadRequest): Promise<boolean> {
  if (req.payload.db.name !== 'postgres' || !(await req.transactionID)) return false
  await lockBranchInPostgres(collection, id, req)
  return true
}

/**
 * Stores the paths and ancestors of the documents below a moved document, and of their latest
 * versions, with statements of the package's own: a few per move, whatever the size of the branch,
 * where Payload's database API writes one row at a time, whole. They replace only the start of a
 * path, in the rows that hang below the document when they run, and leave every other value of the
 * row as it was, updatedAt too. They run in the request's transaction, where the database has one.
 */
export async function setPathAndAncestorsBelow(collection: string, id: Id, starts: StartsBelow, req: PayloadRequest) {
  const { payload } = req
  const localized = isLocalized(collection, payload)
  const parentField = getParentFieldName(collection, payload)
  // A collection that isn't localized holds one path for every locale, so one start serves them all.
  const paths = localized ? starts.paths : starts.paths.slice(0, 1)
  const buildStatementsBelow = usesSql(payload.db.name) ? buildStatementsBelowInSql : buildStatementsBelowInMongodb
  const buildRowKindStatements = await buildStatementsBelow(collection, id, localized, req)
  const rowKinds = hasDraftsEnabled(payload.collections[collection as CollectionSlug].config)
    ? (['documents', 'versions'] as const)
    : (['documents'] as const)
  // The rows below are found by the moved document among their ancestors, which a lift takes out of
  // them, so the ancestors come last, after the paths and the parent.
  for (const rowKind of rowKinds) {
    const { setAncestors, setLiftedParent, setPathStarts } = buildRowKindStatements(rowKind)
    if (paths.length > 0) await setPathStarts(paths)
    if (starts.liftParentId !== undefined && parentField !== undefined) await setLiftedParent(parentField, starts.liftParentId)
    if (starts.ancestors) await setAncestors(starts.ancestors)
  }
}
