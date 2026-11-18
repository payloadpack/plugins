import type { CollectionAfterDeleteHook, CollectionBeforeDeleteHook } from 'payload'

import { findParentPathAndAncestors } from '../database/documents.js'
import { findDocumentAndLatestVersion } from '../database/versions.js'
import { getStoredPathAndAncestors } from '../path/build-path-and-ancestors.js'
import { findBranchMove, moveBranch } from '../path/move-branch.js'
import { changedPath, getBranchChange, getBasePath, getPathConfig, type PathsChange } from '../plugin/options.js'
import { getLocales } from '../utils/locales.js'
import { getShownLocales } from '../utils/published-locales.js'
import { documentKey, getPathContext } from './context.js'

/**
 * Lifts the documents below a deleted document one level: the ones right below it take its parent,
 * in the document and in the latest version, and they and everything below them get the path and
 * ancestors that gives them. Refused when one of them would land on a path that is reserved or
 * taken, or would become the home page.
 */
export const liftBranchBeforeDelete: CollectionBeforeDeleteHook = async ({ collection, id, req }) => {
  const { payload } = req
  const { slug } = collection
  const stored = await findDocumentAndLatestVersion(collection, id, req)
  if (!stored) return
  const { document } = stored
  const { ancestors, paths } = getStoredPathAndAncestors(document, slug, payload)
  const change: PathsChange = {
    paths: getShownLocales(document, collection, payload).flatMap((locale) => {
      const path = paths[locale]
      return path ? [changedPath(locale, path)] : []
    })
  }
  getPathContext(req).deleted.set(documentKey(slug, id), change)
  // The document hangs from the last of its ancestors.
  const parent = await findParentPathAndAncestors(slug, ancestors.at(-1) ?? null, req)
  const branchMove = await findBranchMove({ collection, document, parent, req })
  await moveBranch(branchMove, req)
  if (branchMove.documentsBelow === 0) return
  // What the paths of the lifted documents start with now: the parent's path, or the base path.
  const basePath = getBasePath(slug, getPathConfig(payload))
  const liftedTo = parent ? parent.paths : Object.fromEntries(getLocales(payload).map((locale) => [locale, basePath]))
  change.lifted = getBranchChange(branchMove, id, paths, liftedTo, payload)
}

// The site hears what changed once the document is gone.
export const reportPathsAfterDelete: CollectionAfterDeleteHook = async ({ collection, id, req }) => {
  const { deleted } = getPathContext(req)
  const key = documentKey(collection.slug, id)
  const change = deleted.get(key)
  deleted.delete(key)
  if (change && (change.paths.length > 0 || change.lifted)) await getPathConfig(req.payload).onPathsChanged?.(change, req)
}
