import type {
  CollectionSlug,
  DataFromCollectionSlug,
  FindOptions,
  Payload,
  SelectType,
  TransformCollectionWithSelect,
  TypedCollectionSelect,
  Where
} from 'payload'
import { getSelectMode, hasDraftsEnabled } from 'payload/shared'

import { getPathConfig, pickCollections, type PathCollectionSlug } from '../plugin/options.js'
import { getReservedPathRefusal } from '../validation/get-reserved-path-refusal.js'
import { findPaths, type FoundPath } from './find-paths.js'

type SelectFor<Slug extends CollectionSlug> = TypedCollectionSelect[Slug]

/** A document found at a path, with the collection it is in, among the collections named. */
export type FoundByPath<Slug extends PathCollectionSlug = PathCollectionSlug, TSelect = never> = {
  [Each in Slug]: {
    collection: Each
    document: [TSelect] extends [never]
      ? DataFromCollectionSlug<Each>
      : TSelect extends SelectType
        ? TransformCollectionWithSelect<Each, TSelect>
        : DataFromCollectionSlug<Each>
  }
}[Slug]

type ForwardedFindOptions<Slug extends CollectionSlug> = Omit<
  FindOptions<Slug, SelectType>,
  'collection' | 'currentDepth' | 'draft' | 'limit' | 'locale' | 'page' | 'pagination' | 'select' | 'sort' | 'trash'
>

type FindByPathArguments<
  Slug extends PathCollectionSlug,
  TSelect extends SelectFor<Slug> = never
> = ForwardedFindOptions<Slug> & {
  /** The collections to look in, among the plugin's. Without it, every one of them. */
  collections?: Slug[]
  /**
   * false throws Payload's Forbidden for a collection the reader may not read at all. Defaults to
   * true, so such a collection has nothing at the path.
   */
  disableErrors?: boolean
  /** true finds the latest draft at the path, for a preview. Defaults to false. */
  draft?: boolean
  /** With localization, the locale whose path this is. The site keeps the locale out of the path. */
  locale?: string
  /** The path as it is stored: it starts with a slash and, but for the home page's /, ends with none. */
  path: string
  /** true also gives the document's path in each locale, as findPaths does. */
  paths?: true
  payload: Payload
  /** Fields to include or exclude on the returned document, as in Payload's find. */
  select?: TSelect
}

// A published lookup checks _status on the returned docs, so ensure _status is selected and strip
// it again when the caller's select left it out.
function buildSelectWithStatus(select: SelectType | undefined, published: boolean) {
  if (!select || !published) return { querySelect: select, stripStatus: false }
  if (getSelectMode(select) === 'include') {
    if (select._status === true) return { querySelect: select, stripStatus: false }
    return { querySelect: { ...select, _status: true }, stripStatus: true }
  }
  if (select._status === false) {
    const rest = { ...select }
    delete rest._status
    return { querySelect: Object.keys(rest).length > 0 ? rest : undefined, stripStatus: true }
  }
  return { querySelect: select, stripStatus: false }
}

function buildWhere(path: string, published: boolean, where: Where | undefined): Where {
  const conditions: Where[] = [{ path: { equals: path } }]
  // A published lookup asks that the locale holds a status of its own, because Payload's read fills
  // a missing one from the fallback locale, where the document was never published. It asks that the
  // status exists and not which one it is: with a second equality SQLite, which keeps no statistics,
  // may read the status index instead of the path index.
  if (published) conditions.push({ _status: { exists: true } })
  if (where) conditions.push(where)
  return conditions.length === 1 ? conditions[0]! : { and: conditions }
}

/**
 * The document at a path, across the collections the plugin is given, for a site's route: one
 * indexed query per collection, run at once, and none for a reserved path. It forwards Payload's
 * find options, defaulting depth to 0, draft to false, overrideAccess to true and disableErrors to true.
 */
export function findByPath<Slug extends PathCollectionSlug = PathCollectionSlug, TSelect extends SelectFor<Slug> = never>(
  args: FindByPathArguments<Slug, TSelect> & { paths: true }
): Promise<(FoundByPath<Slug, TSelect> & { paths: FoundPath[] }) | null>
export function findByPath<Slug extends PathCollectionSlug = PathCollectionSlug, TSelect extends SelectFor<Slug> = never>(
  args: FindByPathArguments<Slug, TSelect>
): Promise<FoundByPath<Slug, TSelect> | null>
export async function findByPath<Slug extends PathCollectionSlug = PathCollectionSlug, TSelect extends SelectFor<Slug> = never>({
  collections,
  depth = 0,
  disableErrors = true,
  draft = false,
  locale,
  overrideAccess = true,
  path,
  paths,
  payload,
  req,
  select,
  where,
  ...findOptions
}: FindByPathArguments<Slug, TSelect>) {
  const slugs = pickCollections(collections, getPathConfig(payload))
  if (getReservedPathRefusal(path, payload)) return null

  const findInCollection = async (collection: CollectionSlug): Promise<FoundByPath<Slug, TSelect> | null> => {
    const published = !draft && hasDraftsEnabled(payload.collections[collection].config)
    const { querySelect, stripStatus } = buildSelectWithStatus(select as SelectType | undefined, published)
    const { docs } = await payload.find({
      ...findOptions,
      collection,
      depth,
      disableErrors,
      draft,
      locale,
      overrideAccess,
      pagination: false,
      req,
      select: querySelect as SelectFor<CollectionSlug> | undefined,
      where: buildWhere(path, published, where)
    })
    const matched = published ? docs.find(({ _status }) => _status === 'published') : docs[0]
    if (!matched) return null
    if (!stripStatus) return { collection, document: matched } as FoundByPath<Slug, TSelect>
    const document = { ...matched }
    delete document._status
    return { collection, document } as FoundByPath<Slug, TSelect>
  }

  let found: FoundByPath<Slug, TSelect> | null = null
  if (req?.transactionID) {
    // MongoDB doesn't support parallel operations in one transaction.
    for (const collection of slugs) {
      found = await findInCollection(collection)
      if (found) break
    }
  } else {
    const foundInCollections = await Promise.all(slugs.map(findInCollection))
    found = foundInCollections.find((foundInCollection) => foundInCollection !== null) ?? null
  }

  if (!found) return null
  if (!paths) return found
  return {
    ...found,
    paths: await findPaths({ collection: found.collection, draft, id: found.document.id, payload, req })
  }
}
