import type { CollectionAfterDeleteHook } from 'payload'

import { getPathConfig } from '../plugin/options.js'
import { documentKey, getPathContext } from './context.js'

/**
 * Tells the site which paths a delete changed: the document's own, and where the documents below it
 * were lifted to. It runs in Payload's afterDelete because the site should hear once the document
 * is gone, and the hook before the delete kept what to tell.
 */
export const reportPathsAfterDelete: CollectionAfterDeleteHook = async ({ collection, id, req }) => {
  const { deleted } = getPathContext(req)
  const key = documentKey(collection.slug, id)
  const change = deleted.get(key)
  deleted.delete(key)
  if (change && (change.paths.length > 0 || change.lifted)) await getPathConfig(req.payload).onPathsChanged?.(change, req)
}
