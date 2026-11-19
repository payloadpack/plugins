import type { CollectionAfterDeleteHook } from 'payload'

import { documentKey, getBulkOperation, getPathContext } from './context.js'
import { reportChangedPaths, withLastLandings } from './paths-change.js'

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
  if (!kept) return
  const landings = getBulkOperation(req, collection.slug)?.landings
  await reportChangedPaths(landings ? withLastLandings(kept, landings) : kept, req)
}
