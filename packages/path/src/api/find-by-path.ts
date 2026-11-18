import type { CollectionSlug, DataFromCollectionSlug, Payload, Where } from 'payload'

import { getReservedPathRefusal, getPathConfig, pickCollections } from '../plugin/options.js'
import { hasDrafts } from '../utils/published-locales.js'

/** A document found at a path, with the collection it is in, among the collections named. */
export type FoundByPath<Slug extends CollectionSlug = CollectionSlug> = {
  [Each in Slug]: { collection: Each; document: DataFromCollectionSlug<Each> }
}[Slug]

/**
 * The document at a path, across the collections the plugin is given, for a site's route: one
 * indexed query per collection, run at once, and none for a reserved path. It reads as the server,
 * so it returns a published document unless draft is set.
 */
export async function findByPath<Slug extends CollectionSlug = CollectionSlug>({
  collections,
  depth = 0,
  draft = false,
  locale,
  path,
  payload
}: {
  /** The collections to look in, among the plugin's. Without it, every one of them. */
  collections?: Slug[]
  /** How deep the document's relationships are populated, as in Payload's find. Defaults to 0. */
  depth?: number
  /** true finds the latest draft at the path, for a preview. Defaults to false. */
  draft?: boolean
  /** With localization, the locale whose path this is. The site keeps the locale out of the path. */
  locale?: string
  /** The path as it is stored: it starts with a slash and, but for the home page's /, ends with none. */
  path: string
  payload: Payload
}): Promise<FoundByPath<Slug> | null> {
  const slugs = pickCollections(collections, getPathConfig(payload))
  if (getReservedPathRefusal(path, payload)) return null
  const found = await Promise.all(
    slugs.map(async (collection) => {
      const published = !draft && hasDrafts(payload.collections[collection].config)
      // The query names the path, so a database reads the path index for it. A published lookup also
      // asks that the locale holds a status of its own, because Payload's read fills a missing one
      // from the fallback locale, where the document was never published. It asks that the status
      // exists and not which one it is: with a second equality SQLite, which keeps no statistics, may
      // read the status index instead. The status is read off what comes back, which is the one
      // document a path belongs to.
      const atPath: Where = { path: { equals: path } }
      const { docs } = await payload.find({
        collection,
        depth,
        draft,
        locale,
        overrideAccess: true,
        pagination: false,
        where: published ? { and: [atPath, { _status: { exists: true } }] } : atPath
      })
      const document = published ? docs.find(({ _status }) => _status === 'published') : docs[0]
      return document ? ({ collection, document } as FoundByPath<Slug>) : null
    })
  )
  return found.find((foundInCollection) => foundInCollection !== null) ?? null
}
