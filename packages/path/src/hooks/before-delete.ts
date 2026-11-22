import type { CollectionBeforeDeleteHook, CollectionConfig, PayloadRequest } from 'payload'

import { findDocumentById, findParentPathAndAncestors } from '../database/documents.js'
import { getStoredPathAndAncestors, type Id } from '../path/build-path-and-ancestors.js'
import { findBranchMove, moveBranch } from '../path/move-branch.js'
import { getShownLocales } from '../utils/published-locales.js'
import { checkBranchMove } from '../validation/check-branch-move.js'
import { documentKey, getBulkOperation, getPathContext, type BulkOperation } from './context.js'
import { changedPath, getChangedPathsBelow } from './paths-change.js'

async function findLift(collection: CollectionConfig, id: Id, req: PayloadRequest) {
  const document = await findDocumentById(collection.slug, id, req)
  if (!document) return
  const { ancestors, paths } = getStoredPathAndAncestors(document, collection.slug, req.payload)
  // The document hangs from the last of its ancestors, and so do the ones below once it is gone.
  const parent = await findParentPathAndAncestors(collection.slug, ancestors.at(-1) ?? null, req)
  const branchMove = await findBranchMove({ collection, id, parent, req })
  await checkBranchMove(branchMove, req)
  return { branchMove, document, paths }
}

// It runs first among the collection's beforeDelete hooks, so a refusal comes before the collection's
// own. It writes nothing: the hook after them lifts.
export const checkLiftBeforeDelete: CollectionBeforeDeleteHook = async ({ collection, id, req }) => {
  await findLift(collection, id, req)
}

async function liftBranch(collection: CollectionConfig, id: Id, req: PayloadRequest, bulkOperation?: BulkOperation) {
  const { payload } = req
  const { slug } = collection
  const lift = await findLift(collection, id, req)
  if (!lift) return
  const { branchMove, document, paths } = lift
  await moveBranch(branchMove, req)

  // For the hook after the delete, which reports once the document is gone.
  const ownPaths = getShownLocales(document, collection, payload).flatMap((locale) => {
    const path = paths[locale]
    return path ? [changedPath(slug, document.id, locale, path, null)] : []
  })
  getPathContext(req).deleted.set(documentKey(slug, id), [...ownPaths, ...getChangedPathsBelow(branchMove, payload)])
  // A later lift in a bulk delete may move a lifted document again.
  for (const { document: lifted, pathAndAncestors, storedPaths } of branchMove.documents) {
    const key = String(lifted.id)
    const from = bulkOperation?.lifts.get(key)?.from ?? storedPaths
    bulkOperation?.lifts.set(key, { from, to: pathAndAncestors.paths })
  }
}

// Runs in beforeDelete because the document the ones below hang from is still stored there, and
// Payload's own hierarchy would delete them with it. It runs last among the collection's beforeDelete
// hooks, so a delete the collection's own hooks refuse moves nothing.
export const liftBranchBeforeDelete: CollectionBeforeDeleteHook = ({ collection, id, req }) => {
  const bulkOperation = getBulkOperation(req, collection.slug)
  if (!bulkOperation) return liftBranch(collection, id, req)
  // In a bulk delete Payload runs the beforeDelete hooks of every document at once and deletes none of
  // them until all are done. So the lifts run one at a time, each reading and checking again from what
  // the one before wrote, which is how a document below two deleted ones lands below neither.
  const lifting = bulkOperation.lifting.then(() => liftBranch(collection, id, req, bulkOperation))
  // A lift that is refused refuses its own delete only.
  bulkOperation.lifting = lifting.catch(() => {})
  return lifting
}
