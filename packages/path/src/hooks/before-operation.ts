import type { CollectionBeforeOperationHook } from 'payload'

import { findDocumentIdOfVersion } from '../database/versions.js'
import type { Id } from '../path/build-path-and-ancestors.js'
import { documentKey, getBulkOperation, getPathContext, startBulkOperation } from './context.js'

/**
 * Starts what the documents of a bulk update or a bulk delete hand each other on its request, and
 * marks a document that an operation by id saves while one is there as saved on its own. It runs in
 * Payload's beforeOperation because that runs once for each operation, before any of its documents,
 * and is where a bulk operation, which names no id, is told from one by id. It is also the only hook
 * Payload tells whether an update was sent as a draft save, which the check before the write needs:
 * an unpublish has the status of a draft save and writes the document itself.
 *
 * A bulk operation starts fresh, in place of whatever one that failed as a whole left behind: Payload
 * skips the afterOperation of an operation that throws. A document saved on its own neither takes
 * paths nor looks at the ones taken, so what a bulk operation took never refuses a save by id on the
 * same request, also not after that bulk operation failed. A restore names the version, so the
 * document is read off it, which only a request that holds a bulk operation of the collection does.
 */
export const startBulkOperationBeforeOperation: CollectionBeforeOperationHook = async ({ args, collection, operation, req }) => {
  if (operation !== 'update' && operation !== 'delete' && operation !== 'restoreVersion') return
  const { slug } = collection
  const id = 'id' in args ? (args.id as Id | undefined) : undefined
  const sentAsDraft = 'draft' in args && Boolean(args.draft)
  if (!id) {
    if (operation !== 'restoreVersion') startBulkOperation(req, slug, sentAsDraft)
    return
  }
  if (operation === 'update') getPathContext(req).sentAsDraft.set(documentKey(slug, id), sentAsDraft)
  // A delete takes nothing, so a delete by id has nothing to mark.
  const bulkOperation = operation === 'delete' ? undefined : getBulkOperation(req, slug)
  if (!bulkOperation) return
  const saved = operation === 'restoreVersion' ? await findDocumentIdOfVersion(slug, id, req) : id
  if (saved !== undefined) bulkOperation.savedOnTheirOwn.add(String(saved))
}
