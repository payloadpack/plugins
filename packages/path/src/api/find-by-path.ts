import type { CollectionSlug, DataFromCollectionSlug, Payload, Where } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { getPathConfig, pickCollections } from '../plugin/options.js'
import { getReservedPathRefusal } from '../validation/get-reserved-path-refusal.js'
import { findPaths, type FoundPath } from './find-paths.js'

/** A document found at a path, with the collection it is in, among the collections named. */
export type FoundByPath<Slug extends CollectionSlug = CollectionSlug> = {
  [Each in Slug]: { collection: Each; document: DataFromCollectionSlug<Each> }
}[Slug]

type FindByPathArguments<Slug extends CollectionSlug> = {
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
  /** true also gives the document's path in each locale, as findPaths does. */
  paths?: true
  payload: Payload
}

/**
 * The document at a path, across the collections the plugin is given, for a site's route: one
 * indexed query per collection, run at once, and none for a reserved path. It reads as the server,
 * so it returns a published document unless draft is set.
 */
export function findByPath<Slug extends CollectionSlug = CollectionSlug>(
  args: FindByPathArguments<Slug> & { paths: true }
): Promise<(FoundByPath<Slug> & { paths: FoundPath[] }) | null>
export function findByPath<Slug extends CollectionSlug = CollectionSlug>(
  args: FindByPathArguments<Slug>
): Promise<FoundByPath<Slug> | null>
export async function findByPath<Slug extends CollectionSlug>({
  collections,
  depth = 0,
  draft = false,
  locale,
  path,
  paths,
  payload
}: FindByPathArguments<Slug>) {
  const slugs = pickCollections(collections, getPathConfig(payload))
  if (getReservedPathRefusal(path, payload)) return null
  const foundInCollections = await Promise.all(
    slugs.map(async (collection) => {
      const published = !draft && hasDraftsEnabled(payload.collections[collection].config)
      // A published lookup asks that the locale holds a status of its own, because Payload's read fills
      // a missing one from the fallback locale, where the document was never published. It asks that the
      // status exists and not which one it is: with a second equality SQLite, which keeps no statistics,
      // may read the status index instead of the path index.
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
  const found = foundInCollections.find((foundInCollection) => foundInCollection !== null)
  if (!found) return null
  if (!paths) return found
  return { ...found, paths: await findPaths({ collection: found.collection, draft, id: found.document.id, payload }) }
}
