import type { PayloadRequest } from 'payload'

import type { Id, PathAndAncestors } from '../path/build-path-and-ancestors.js'
import type { PathsChange } from './paths-change.js'

// Where the document itself was before a save's write, and the locales a site found it in there.
export type PathAndAncestorsBefore = PathAndAncestors & { shownLocales: string[] }

// What the plugin's hooks hand each other on one request, by document.
type PathContext = {
  // What each delete changes, from before the delete until after it.
  deleted: Map<string, PathsChange>
  // Where each saved document was, from before its write until after it.
  saved: Map<string, PathAndAncestorsBefore>
}

const CONTEXT_KEY = 'payloadpackPath'

export function getPathContext(req: PayloadRequest): PathContext {
  req.context[CONTEXT_KEY] ??= { deleted: new Map(), saved: new Map() } satisfies PathContext
  return req.context[CONTEXT_KEY] as PathContext
}

// What the context keeps a document's entry under.
export const documentKey = (collection: string, id: Id) => `${collection}:${id}`
