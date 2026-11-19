import type { CollectionBeforeOperationHook } from 'payload'

import { findDocumentIdOfVersion } from '../database/versions.js'
import type { Id } from '../path/build-path-and-ancestors.js'
import { documentKey, getBulkOperation, getPathContext, startBulkOperation } from './context.js'

/**
 * Runs in beforeOperation because it runs once for each operation, before any of its documents, tells
 * a bulk operation (no id) from one by id, and is the only hook told whether an update or a restore
 * was sent as a draft.
 *
 * - Bulk update or delete: starts what its documents hand each other on its request, fresh, since
 *   Payload skips afterOperation when an operation throws and so leaves a failed one's behind.
 * - Update or restore by id: notes whether Payload writes the document itself, for the check before
 *   the write. An unpublish and a draft version restored as the document have a draft save's status
 *   and still write it. A restore names the version, so the document is read off it.
 * - By id while a bulk operation is there: marks the document as saved on its own, so it neither
 *   takes paths nor looks at the ones taken, and what the bulk operation took never refuses it, also
 *   after that one failed.
 */
export const startBulkOperationBeforeOperation: CollectionBeforeOperationHook = async ({ args, collection, operation, req }) => {
  if (operation !== 'update' && operation !== 'delete' && operation !== 'restoreVersion') return
  const { slug } = collection
  const id = 'id' in args ? (args.id as Id | undefined) : undefined
  const sentAsDraft = 'draft' in args && Boolean(args.draft)
  const documentWrite = !sentAsDraft ? 'always' : operation === 'restoreVersion' ? 'never' : 'whenPublished'
  if (!id) {
    if (operation !== 'restoreVersion') startBulkOperation(req, slug, documentWrite)
    return
  }
  // A delete saves nothing, so a delete by id has nothing to note or to mark.
  if (operation === 'delete') return
  const saved = operation === 'restoreVersion' ? await findDocumentIdOfVersion(slug, id, req) : id
  if (saved === undefined) return
  getPathContext(req).documentWrites.set(documentKey(slug, saved), documentWrite)
  getBulkOperation(req, slug)?.savedOnTheirOwn.add(String(saved))
}
