import type { PayloadRequest, Where } from 'payload'

import { findDocument, type StoredDocument } from '../database/documents.js'
import { getPaths, type Id, type LocalePath } from '../path/build-path-and-ancestors.js'
import { getPathConfig, isLocalized } from '../plugin/options.js'
import { inChunks } from '../utils/in-chunks.js'
import { fieldKey } from '../utils/locales.js'

export type TakenPath = { collection: string; document: StoredDocument; locale: string; path: string }

// The documents the paths are for, which are not in their own way.
type Self = {
  // The documents below them, which move along with them.
  below?: StoredDocument[]
  collection: string
  ids: Id[]
}

export const pathKey = (locale: string, path: string) => `${locale} ${path}`

export async function findTakenPath(paths: LocalePath[], self: Self, req: PayloadRequest): Promise<TakenPath | undefined> {
  if (paths.length === 0) return
  const { payload } = req
  const below = new Set<string>()
  const idsBelow = new Map<string, Id[]>()
  for (const { id, path: stored } of self.below ?? []) {
    below.add(String(id))
    for (const [locale, path] of Object.entries(getPaths(stored, self.collection, payload))) {
      if (path === null) continue
      const key = pathKey(locale, path)
      idsBelow.set(key, [...(idsBelow.get(key) ?? []), id])
    }
  }
  // One query at a time, because inside a transaction MongoDB refuses parallel operations.
  for (const { slug: collection } of getPathConfig(payload).collections) {
    // A collection that isn't localized holds one path for every locale, so there the query names
    // each path once.
    const localized = isLocalized(collection, payload)
    const keyOf = (locale: string) => fieldKey('path', locale, localized)
    const inTrash = Boolean(payload.collections[collection].config.trash)
    for (const chunk of inChunks(paths)) {
      const atPath: Where = {
        or: [...new Set(chunk.map(([locale]) => keyOf(locale)))].map((key) => ({
          [key]: { in: [...new Set(chunk.flatMap(([locale, path]) => (keyOf(locale) === key ? [path] : [])))] }
        }))
      }
      // Leaves out the documents below that store one of the paths, so the query never names a whole
      // branch.
      const own =
        collection === self.collection
          ? [...new Set([...self.ids, ...chunk.flatMap(([locale, path]) => idsBelow.get(pathKey(locale, path)) ?? [])])]
          : []
      const notInTrash: Where[] = inTrash ? [{ deletedAt: { exists: false } }] : []
      const findOther = () =>
        findDocument(collection, { and: [atPath, ...(own.length > 0 ? [{ id: { not_in: own } }] : []), ...notInTrash] }, req)
      let document = await findOther()
      // A document below found all the same was written after the branch was read, by a save of its
      // own in the same bulk update, and moves along like the rest.
      while (document && collection === self.collection && below.has(String(document.id))) {
        own.push(document.id)
        document = await findOther()
      }
      if (!document) continue
      const documentPaths = getPaths(document.path, collection, payload)
      const taken = paths.filter(([pathLocale, takenPath]) => documentPaths[pathLocale] === takenPath)
      // The locale of the request first, which an editor can act on.
      const [locale, path] = taken.find(([pathLocale]) => pathLocale === req.locale) ?? taken[0] ?? paths[0]!
      return { collection, document, locale, path }
    }
  }
}
