import type { PayloadRequest } from 'payload'

import type { Id, PathAndAncestors, Paths } from '../path/build-path-and-ancestors.js'
import type { TakenPaths } from '../validation/take-paths.js'
import type { PathsChange } from './paths-change.js'

// Where the document itself was before a save's write, and the locales a site found it in there.
export type PathAndAncestorsBefore = PathAndAncestors & { shownLocales: string[] }

// What the plugin's hooks hand each other on one request, by document.
type PathContext = {
  // What each delete changes, from after its lift until after the delete.
  deleted: Map<string, PathsChange>
  // Where each saved document was, from before its write until after it.
  saved: Map<string, PathAndAncestorsBefore>
  // Whether the update by id that saves each document was sent as a draft save, from before the
  // operation until the check before the write.
  sentAsDraft: Map<string, boolean>
}

const CONTEXT_KEY = 'payloadpackPath'

export function getPathContext(req: PayloadRequest): PathContext {
  req.context[CONTEXT_KEY] ??= { deleted: new Map(), saved: new Map(), sentAsDraft: new Map() } satisfies PathContext
  return req.context[CONTEXT_KEY] as PathContext
}

// What the context keeps a document's entry under.
export const documentKey = (collection: string, id: Id) => `${collection}:${id}`

// Whether the update by id that saves a document was sent as a draft save, read once, so a later
// save of the document that isn't an update, such as a restored version, doesn't read it.
export function takeSentAsDraft(req: PayloadRequest, collection: string, id: Id) {
  const { sentAsDraft } = getPathContext(req)
  const key = documentKey(collection, id)
  const sent = sentAsDraft.get(key)
  sentAsDraft.delete(key)
  return sent
}

/**
 * What the documents of a bulk update or a bulk delete of one collection hand each other, because
 * Payload runs them at once on one request. Each bulk operation starts a fresh one, so what one that
 * failed as a whole left behind is never read again.
 */
export type BulkOperation = {
  // Whether a bulk update was sent as a draft save.
  sentAsDraft: boolean
  // The documents an operation by id saves while this is on the request, such as a site's hook that
  // saves with the bulk operation's request. They are not of the bulk operation, so they neither
  // take paths nor look at the ones taken.
  savedOnTheirOwn: Set<string>
  // Where the documents of a bulk update are about to be put.
  takenPaths: TakenPaths
  // The lifts of a bulk delete, one at a time: settles once the last one begun has ended.
  lifting: Promise<void>
  // Where the lifts of a bulk delete last put each document below, by its id.
  landings: Map<string, Paths>
}

/**
 * Kept on the request object itself, under a key of the plugin's own: Payload gives each document of
 * a bulk update of an upload collection a copy of the request that reads and writes every other
 * property through to the request itself. Not in its context, because a site may pass one context
 * object to many requests.
 */
const BULK_OPERATIONS = Symbol('payloadpackPathBulkOperations')

const withBulkOperations = (req: PayloadRequest) => req as PayloadRequest & { [BULK_OPERATIONS]?: Map<string, BulkOperation> }

export function startBulkOperation(req: PayloadRequest, collection: string, sentAsDraft: boolean) {
  const bulkOperations = (withBulkOperations(req)[BULK_OPERATIONS] ??= new Map())
  bulkOperations.set(collection, {
    landings: new Map(),
    lifting: Promise.resolve(),
    savedOnTheirOwn: new Set(),
    sentAsDraft,
    takenPaths: new Map()
  })
}

export const getBulkOperation = (req: PayloadRequest, collection: string) =>
  withBulkOperations(req)[BULK_OPERATIONS]?.get(collection)

export const endBulkOperation = (req: PayloadRequest, collection: string) =>
  withBulkOperations(req)[BULK_OPERATIONS]?.delete(collection)
