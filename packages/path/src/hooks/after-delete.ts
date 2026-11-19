import type { CollectionAfterDeleteHook } from 'payload'

import { getPathConfig } from '../plugin/options.js'
import { documentKey, getBulkOperation, getPathContext } from './context.js'
import { buildBranchChangeToLastLandings } from './paths-change.js'

/**
 * Tells the site which paths a delete changed: the document's own, and where the documents below it
 * were lifted to, which in a bulk delete is where the last lift put each. It runs in Payload's
 * afterDelete because the site should hear once the document is gone, and the hook before the
 * delete kept what to tell.
 */
export const reportPathsAfterDelete: CollectionAfterDeleteHook = async ({ collection, id, req }) => {
  const { deleted } = getPathContext(req)
  const key = documentKey(collection.slug, id)
  const kept = deleted.get(key)
  deleted.delete(key)
  if (!kept || (kept.paths.length === 0 && !kept.lifted)) return
  const landings = getBulkOperation(req, collection.slug)?.landings
  const change = kept.lifted && landings ? { ...kept, lifted: buildBranchChangeToLastLandings(kept.lifted, landings) } : kept
  await getPathConfig(req.payload).onPathsChanged?.(change, req)
}
