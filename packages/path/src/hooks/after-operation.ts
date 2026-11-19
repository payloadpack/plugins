import type { CollectionAfterOperationHook } from 'payload'

import { endBulkOperation } from './context.js'

/**
 * Ends what the documents of a bulk update or a bulk delete handed each other on its request. It runs
 * in Payload's afterOperation because that runs once the last document is done, and Payload names a
 * bulk operation there apart from one by id. Nothing depends on it: Payload skips it for an operation
 * that throws as a whole, and the next bulk operation of the collection starts fresh.
 */
export const endBulkOperationAfterOperation: CollectionAfterOperationHook = ({ collection, operation, req, result }) => {
  if (operation === 'update' || operation === 'delete') endBulkOperation(req, collection.slug)
  return result
}
