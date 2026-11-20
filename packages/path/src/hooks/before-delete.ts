import type { CollectionBeforeDeleteHook, CollectionConfig, PayloadRequest } from 'payload'

import { findDocumentById, findParentPathAndAncestors } from '../database/documents.js'
import { getStoredPathAndAncestors, type Id } from '../path/build-path-and-ancestors.js'
import { findBranchMove, moveBranch } from '../path/move-branch.js'
import { getShownLocales } from '../utils/published-locales.js'
import { checkBranchMove } from '../validation/check-branch-move.js'
import { documentKey, getBulkOperation, getPathContext, type BulkOperation } from './context.js'
import { changedPath, getChangedPathsBelow } from './paths-change.js'

// Where the documents below a document go once it is deleted, refused where one of them can't land,
// as the database holds them now. The document hangs from the last of its ancestors, and so do they
// once it is gone. Nothing for a document that isn't stored.
async function findLift(collection: CollectionConfig, id: Id, req: PayloadRequest) {
  const document = await findDocumentById(collection.slug, id, req)
  if (!document) return
  const pathAndAncestorsBefore = getStoredPathAndAncestors(document, collection.slug, req.payload)
  const parent = await findParentPathAndAncestors(collection.slug, pathAndAncestorsBefore.ancestors.at(-1) ?? null, req)
  const branchMove = await findBranchMove({ collection, id, parent, pathAndAncestorsBefore, req })
  await checkBranchMove(branchMove, req)
  return { branchMove, document, paths: pathAndAncestorsBefore.paths }
}

/**
 * Refuses a delete whose documents below can't land where a lift would put them: on a path that is
 * reserved or taken, or as the home page. It runs first among the collection's beforeDelete hooks, so
 * a refusal comes before the collection's own. It writes nothing: the hook after them lifts.
 */
export const checkLiftBeforeDelete: CollectionBeforeDeleteHook = async ({ collection, id, req }) => {
  await findLift(collection, id, req)
}

// Lifts the documents below, and keeps what the site hears once the document is gone.
async function liftBranch(collection: CollectionConfig, id: Id, req: PayloadRequest, bulkOperation?: BulkOperation) {
  const { payload } = req
  const { slug } = collection
  const lift = await findLift(collection, id, req)
  if (!lift) return
  const { branchMove, document, paths } = lift
  await moveBranch(branchMove, req)

  // For the hook after the delete: the paths a site found the document at, which it finds it at no
  // more, and where the lifted documents went. A bulk delete also keeps where each lifted document
  // is now, since a later lift of it may move it again.
  const ownPaths = getShownLocales(document, collection, payload).flatMap((locale) => {
    const path = paths[locale]
    return path ? [changedPath(slug, document.id, locale, path, null)] : []
  })
  getPathContext(req).deleted.set(documentKey(slug, id), [...ownPaths, ...getChangedPathsBelow(branchMove, payload)])
  for (const { document: lifted, pathAndAncestors } of branchMove.documents) {
    bulkOperation?.landings.set(String(lifted.id), pathAndAncestors.paths)
  }
}

/**
 * Lifts the documents below a document that is being deleted one level. It runs in Payload's
 * beforeDelete because the document they hang from is still stored there, and Payload's own
 * hierarchy would delete the documents below with it. It runs last among the collection's
 * beforeDelete hooks, so a delete the collection's own hooks refuse moves nothing.
 *
 * The ones right below take its parent, in the document and in the latest version, and they and
 * everything below them get the path and ancestors that gives them. It reads and checks again what
 * the hook before checked, because in a bulk delete Payload runs the beforeDelete hooks of every
 * document at once and deletes none of them until all are done. So in a bulk delete the lifts run
 * one at a time, each from what the one before wrote, which is how a document below two deleted ones
 * lands below neither. A lift that is refused refuses its own delete only.
 */
export const liftBranchBeforeDelete: CollectionBeforeDeleteHook = ({ collection, id, req }) => {
  const bulkOperation = getBulkOperation(req, collection.slug)
  if (!bulkOperation) return liftBranch(collection, id, req)
  const lifting = bulkOperation.lifting.then(() => liftBranch(collection, id, req, bulkOperation))
  bulkOperation.lifting = lifting.catch(() => {})
  return lifting
}
