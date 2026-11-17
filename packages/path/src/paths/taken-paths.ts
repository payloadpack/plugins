import type { PayloadRequest, Where } from 'payload'

import { getPathConfig, isLocalized } from '../plugin/options.js'
import { fieldKey } from './locales.js'
import { readPaths, type Id, type StoredDocument } from './place.js'

// A path a document is at, in one locale, with that document and the collection it is in.
export type TakenPath = { collection: string; document: StoredDocument; locale: string; path: string }

/**
 * Finds a document that is at one of the paths, in any collection given to the plugin. Every document
 * takes its path, whatever its status, except one in the trash, and a latest version's plan takes
 * nothing. A document of a collection that isn't localized is at its one path in every locale, so it
 * is in the way of that path in any locale. Of the locales the document is in the way in, the result
 * names the one of the request, which an editor can act on, before another. One query per collection,
 * one at a time, because inside a transaction MongoDB refuses parallel operations.
 */
export async function findTakenPath(
  paths: [locale: string, path: string][],
  // The documents the paths are for, which are not in their own way.
  self: { collection: string; ids: Id[] },
  req: PayloadRequest
): Promise<TakenPath | undefined> {
  if (paths.length === 0) return
  for (const { slug: collection } of getPathConfig(req.payload).collections) {
    // What the collection's rows hold a locale's path under, which is the one path for every locale
    // in a collection that isn't localized, so there the query names each path once.
    const keyOf = (locale: string) => fieldKey('path', locale, isLocalized(collection, req.payload))
    const atPath: Where = {
      or: [...new Set(paths.map(([locale]) => keyOf(locale)))].map((key) => ({
        [key]: { in: [...new Set(paths.flatMap(([locale, path]) => (keyOf(locale) === key ? [path] : [])))] }
      }))
    }
    const isOwn = collection === self.collection && self.ids.length > 0
    const inTrash = Boolean(req.payload.collections[collection].config.trash)
    const document = await req.payload.db.findOne<StoredDocument>({
      collection,
      joins: false,
      req,
      where: {
        and: [atPath, ...(isOwn ? [{ id: { not_in: self.ids } }] : []), ...(inTrash ? [{ deletedAt: { exists: false } }] : [])]
      }
    })
    if (!document) continue
    const documentPaths = readPaths(document.path, collection, req.payload)
    const taken = paths.filter(([pathLocale, takenPath]) => documentPaths[pathLocale] === takenPath)
    const [locale, path] = taken.find(([pathLocale]) => pathLocale === req.locale) ?? taken[0] ?? paths[0]!
    return { collection, document, locale, path }
  }
}
