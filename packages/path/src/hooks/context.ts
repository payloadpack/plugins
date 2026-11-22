import type { PayloadRequest } from 'payload'

import type { Id, PathAndAncestors, Paths } from '../path/build-path-and-ancestors.js'
import type { TakenPaths } from '../validation/take-paths.js'
import type { ChangedPath } from './paths-change.js'

export type DocumentWrite = 'always' | 'never' | 'whenPublished'

export type PathAndAncestorsBefore = PathAndAncestors & { shownLocales: string[] }

type PathContext = {
  // From after a delete's lift until after the delete.
  deleted: Map<string, ChangedPath[]>
  // From before a save's write until after it.
  saved: Map<string, PathAndAncestorsBefore>
  // From before an operation by id until the check before the write.
  documentWrites: Map<string, DocumentWrite>
}

const CONTEXT_KEY = 'payloadpackPath'

export function getPathContext(req: PayloadRequest): PathContext {
  req.context[CONTEXT_KEY] ??= { deleted: new Map(), documentWrites: new Map(), saved: new Map() } satisfies PathContext
  return req.context[CONTEXT_KEY] as PathContext
}

export const documentKey = (collection: string, id: Id) => `${collection}:${id}`

export function takeDocumentWrite(req: PayloadRequest, collection: string, id: Id) {
  const { documentWrites } = getPathContext(req)
  const key = documentKey(collection, id)
  const write = documentWrites.get(key)
  documentWrites.delete(key)
  return write
}

// Payload runs the documents of a bulk update or a bulk delete at once on one request, so they hand
// each other this.
export type BulkOperation = {
  documentWrite: DocumentWrite
  // The documents an operation by id saves while this is on the request, such as a site's hook that
  // saves with the bulk operation's request. They are not of the bulk operation, so they neither
  // take paths nor look at the ones taken.
  savedOnTheirOwn: Set<string>
  takenPaths: TakenPaths
  // The lifts of a bulk delete, one at a time: settles once the last one begun has ended.
  lifting: Promise<void>
  // The documents its lifts moved that no report has named yet, by id: where each was before the first
  // of those lifts, and where the last one put it.
  lifts: Map<string, Lift>
}

export type Lift = { from: Paths; to: Paths }

// On the request object itself: Payload gives each document of a bulk update of an upload collection a
// copy of the request that reads and writes every other property through to the request itself. Not in
// its context, because a site may pass one context object to many requests.
const BULK_OPERATIONS = Symbol('payloadpackPathBulkOperations')

const withBulkOperations = (req: PayloadRequest) => req as PayloadRequest & { [BULK_OPERATIONS]?: Map<string, BulkOperation> }

export function startBulkOperation(req: PayloadRequest, collection: string, documentWrite: DocumentWrite) {
  const bulkOperations = (withBulkOperations(req)[BULK_OPERATIONS] ??= new Map())
  bulkOperations.set(collection, {
    lifting: Promise.resolve(),
    lifts: new Map(),
    documentWrite,
    savedOnTheirOwn: new Set(),
    takenPaths: new Map()
  })
}

export const getBulkOperation = (req: PayloadRequest, collection: string) =>
  withBulkOperations(req)[BULK_OPERATIONS]?.get(collection)

export const endBulkOperation = (req: PayloadRequest, collection: string) =>
  withBulkOperations(req)[BULK_OPERATIONS]?.delete(collection)
