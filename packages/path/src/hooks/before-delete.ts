import type { CollectionBeforeDeleteHook } from 'payload'

import { findParentPathAndAncestors } from '../database/documents.js'
import { findDocumentAndLatestVersion } from '../database/versions.js'
import { getStoredPathAndAncestors } from '../path/build-path-and-ancestors.js'
import { findBranchMove, getLandings, moveBranch } from '../path/move-branch.js'
import { getBasePath } from '../plugin/options.js'
import { getLocales } from '../utils/locales.js'
import { getShownLocales } from '../utils/published-locales.js'
import { checkBranchMove } from '../validation/check-branch-move.js'
import { freePaths, takePaths } from '../validation/take-paths.js'
import { documentKey, getPathContext } from './context.js'
import { changedPath, getBranchChange, type PathsChange } from './paths-change.js'

/**
 * Lifts the documents below a document that is being deleted one level. It runs in Payload's
 * beforeDelete because a refusal can still stop the delete there, and the document they hang from is
 * still stored: Payload's own hierarchy would delete the documents below with it.
 *
 * The ones right below take its parent, in the document and in the latest version, and they and
 * everything below them get the path and ancestors that gives them. Refused when one of them would
 * land on a path that is reserved or taken, or would become the home page. The delete takes where
 * they land on the request before it asks the database, because Payload runs the documents of a bulk
 * delete at once.
 */
export const liftBranchBeforeDelete: CollectionBeforeDeleteHook = async ({ collection, id, req }) => {
  const { payload } = req
  const { slug } = collection
  const stored = await findDocumentAndLatestVersion(collection, id, req)
  if (!stored) return
  const { document } = stored
  const { ancestors, paths } = getStoredPathAndAncestors(document, slug, payload)

  // For the hook after the delete: the paths a site found the document at.
  const change: PathsChange = {
    paths: getShownLocales(document, collection, payload).flatMap((locale) => {
      const path = paths[locale]
      return path ? [changedPath(locale, path)] : []
    })
  }
  getPathContext(req).deleted.set(documentKey(slug, id), change)

  // Where the documents below go: the document hangs from the last of its ancestors, and so do they
  // once it is gone.
  const parent = await findParentPathAndAncestors(slug, ancestors.at(-1) ?? null, req)
  const branchMove = await findBranchMove({ collection, document, parent, req })

  // Where they land is taken on the request first, then checked against the database, and then they
  // move.
  const by = { collection: slug, id }
  try {
    takePaths(by, getLandings(branchMove), req)
    await checkBranchMove(branchMove, id, req)
    await moveBranch(branchMove, req)
  } finally {
    // The database shows the lifted documents from here on, or the delete was refused.
    freePaths(by, req)
  }

  // For the hook after the delete: where the lifted documents went.
  if (branchMove.below.length === 0) return
  // What the paths of the lifted documents start with now: the parent's path, or the base path.
  const basePath = getBasePath(slug, payload)
  const liftedTo = parent ? parent.paths : Object.fromEntries(getLocales(payload).map((locale) => [locale, basePath]))
  change.lifted = getBranchChange(branchMove, id, paths, liftedTo, payload)
}
