import type { PayloadRequest, Where } from 'payload'

import { findDocument, type StoredDocument } from '../database/documents.js'
import { getPaths, type Id } from '../path/build-path-and-ancestors.js'
import { getPathConfig, isLocalized } from '../plugin/options.js'
import { inChunks } from '../utils/in-chunks.js'
import { fieldKey } from '../utils/locales.js'

// A path a document is at, in one locale, with that document and the collection it is in.
export type TakenPath = { collection: string; document: StoredDocument; locale: string; path: string }

// The documents the paths are for, which are not in their own way.
type Self = {
  // The documents below them, which move along with them.
  below?: StoredDocument[]
  collection: string
  ids: Id[]
}

const pathKey = (locale: string, path: string) => `${locale} ${path}`

/**
 * Finds a document that is at one of the paths, in any collection given to the plugin. Every document
 * takes its path, whatever its status, except one in the trash, and where a latest version would put
 * its document takes nothing. A document of a collection that isn't localized is at its one path in
 * every locale, so it is in the way of that path in any locale. Of the locales the document is in the
 * way in, the result names the one of the request, which an editor can act on, before another. One
 * query per collection and chunk of paths, one at a time, because inside a transaction MongoDB
 * refuses parallel operations. Of the documents below, a query leaves out the ones that store one of
 * its paths, the only ones it could find, so it never names a whole branch.
 */
export async function findTakenPath(
  paths: [locale: string, path: string][],
  self: Self,
  req: PayloadRequest
): Promise<TakenPath | undefined> {
  if (paths.length === 0) return
  const { payload } = req
  const idsBelow = new Map<string, Id[]>()
  for (const { id, path: stored } of self.below ?? []) {
    for (const [locale, path] of Object.entries(getPaths(stored, self.collection, payload))) {
      if (path === null) continue
      const key = pathKey(locale, path)
      idsBelow.set(key, [...(idsBelow.get(key) ?? []), id])
    }
  }
  for (const { slug: collection } of getPathConfig(payload).collections) {
    // What the collection's rows hold a locale's path under, which is the one path for every locale
    // in a collection that isn't localized, so there the query names each path once.
    const keyOf = (locale: string) => fieldKey('path', locale, isLocalized(collection, payload))
    const inTrash = Boolean(payload.collections[collection].config.trash)
    for (const chunk of inChunks(paths)) {
      const atPath: Where = {
        or: [...new Set(chunk.map(([locale]) => keyOf(locale)))].map((key) => ({
          [key]: { in: [...new Set(chunk.flatMap(([locale, path]) => (keyOf(locale) === key ? [path] : [])))] }
        }))
      }
      const own =
        collection === self.collection
          ? [...new Set([...self.ids, ...chunk.flatMap(([locale, path]) => idsBelow.get(pathKey(locale, path)) ?? [])])]
          : []
      const notOwn: Where[] = own.length > 0 ? [{ id: { not_in: own } }] : []
      const notInTrash: Where[] = inTrash ? [{ deletedAt: { exists: false } }] : []
      const document = await findDocument(collection, { and: [atPath, ...notOwn, ...notInTrash] }, req)
      if (!document) continue
      const documentPaths = getPaths(document.path, collection, payload)
      const taken = paths.filter(([pathLocale, takenPath]) => documentPaths[pathLocale] === takenPath)
      const [locale, path] = taken.find(([pathLocale]) => pathLocale === req.locale) ?? taken[0] ?? paths[0]!
      return { collection, document, locale, path }
    }
  }
}
