import type { CollectionConfig, CollectionSlug, Config, Payload, PayloadRequest } from 'payload'
import type { Slugify } from 'payload/shared'

import { NO_LOCALE } from '../paths/locales.js'
import type { Id, Paths } from '../paths/place.js'
import {
  ADMIN_ROUTE_REASON,
  API_ROUTE_REASON,
  BASE_PATH_IS_ROOT,
  BASE_PATH_WITH_EMPTY_SEGMENT,
  BASE_PATH_WITH_LAST_SLASH,
  BASE_PATH_WITHOUT_FIRST_SLASH,
  basePathError,
  notGivenCollectionsError,
  PLUGIN_MISSING_ERROR,
  REFUSAL_FIELD,
  reservedAnyDepthRefusal,
  reservedRootRefusal
} from './messages.js'
import { defaultSlugify } from './slugify.js'

// A path that shows something else, in the locale it belongs to. Without localization there is no locale.
export type ChangedPath = { locale?: string; path: string }

const inLocale = (locale: string) => (locale === NO_LOCALE ? {} : { locale })

export const changedPath = (locale: string, path: string): ChangedPath => ({ ...inLocale(locale), path })

// Where the documents below a document went, so a site can redirect them.
export type BranchChange = {
  collection: string
  // The document that moved, or the deleted document whose documents below were lifted.
  id: Id
  // How many documents sit below it.
  documentsBelow: number
  // Per locale that changed: every path that started with from and a slash now starts with to and a
  // slash. For a move they are the document's own paths. For a lift, from is the deleted document's
  // path and to what was above it: its parent's path, the base path, or nothing at the root.
  paths: { from: string; locale?: string; to: string }[]
}

// Where a branch went, or nothing when it starts with another path in no locale.
export function findBranchChange(branch: Omit<BranchChange, 'paths'>, from: Paths, to: Paths): BranchChange | undefined {
  const paths = Object.entries(from).flatMap(([locale, path]) => {
    const newPath = to[locale]
    return path === null || newPath === null || newPath === undefined || newPath === path
      ? []
      : [{ ...inLocale(locale), from: path, to: newPath }]
  })
  return paths.length > 0 ? { ...branch, paths } : undefined
}

export type PathsChange = {
  // Each published path that shows something else: the path of a publish, the path a document was
  // published at and left or was unpublished at, and the path of a deleted or trashed document.
  paths: ChangedPath[]
  // A save that moved a document with a path, also with nothing below it.
  moved?: BranchChange
  // A delete that lifted the documents below the deleted document.
  lifted?: BranchChange
}

// Reserved segments as a list, or each with a reason that is shown when a slug is refused: at the
// root what the site serves there, and at any depth what the segment means in a path.
export type ReservedSegments = Record<string, string> | string[]

// A collection whose documents get a path, by its slug, or with the base path its top-level
// documents' paths start with, such as /blog, with parent: false when its documents have no parent,
// so each one's path is the base path, a slash and its slug, and with localized: false when, in a
// site with localization, its documents have one slug and one path, the same in every locale.
export type PathCollection = CollectionSlug | { basePath?: string; localized?: false; parent?: false; slug: CollectionSlug }

export type PathPluginOptions = {
  // The collections whose documents get a path. Each one's documents sit below documents of its own,
  // by the plugin's parent field, or by Payload's own where the collection has Payload's hierarchy.
  collections: PathCollection[]
  // The top-level document with this slug, in a collection without a base path, is the home page and
  // answers /. Defaults to 'home'.
  rootSlug?: string
  // Segments a path can't use, at the root and at any depth. Without root, the root segments of
  // Payload's admin and API routes are reserved, and a root that is given is the whole list.
  reservedSegments?: { anyDepth?: ReservedSegments; root?: ReservedSegments }
  // Makes a slug from a title and from what an editor typed, in the shape of the slugify of Payload's
  // own slug field. Defaults to one that takes the accents off Latin letters and keeps the letters of
  // other scripts.
  slugify?: Slugify
  // The most documents a move carries along below the moved document. Defaults to 1,000, about what
  // MongoDB advises for one transaction.
  maxDocumentsPerMove?: number
  // Runs after a save or a delete that changed a published path or moved a branch, so a site purges
  // its own cache and keeps its redirects.
  onPathsChanged?: (change: PathsChange, req: PayloadRequest) => Promise<void> | void
}

// The options with every default filled in, as the plugin stores them on the Payload config.
type PathConfig = {
  // Each collection with its base path, which is empty without one, whether its documents have a
  // parent, and whether they have a slug and a path per locale.
  collections: { basePath: string; hasParent: boolean; localized: boolean; slug: CollectionSlug }[]
  maxDocumentsPerMove: number
  onPathsChanged?: PathPluginOptions['onPathsChanged']
  // Each reserved segment with its reason, if it has one. Without root, Payload's own routes count.
  reservedSegments: { anyDepth: ReasonBySegment; root?: ReasonBySegment }
  rootSlug: string
  slugify: Slugify
}

type ReasonBySegment = Record<string, string | undefined>

const CUSTOM_KEY = 'payloadpackPath'

// Without a base path, a top-level document's path starts with nothing, so it sits at the root.
export const NO_BASE_PATH = ''

// A base path stands where a parent's path would, so it takes the same shape: a slash before each
// segment and none at the end.
function findBasePathFault(basePath: string) {
  if (basePath === '/' || basePath === '') return BASE_PATH_IS_ROOT
  if (!basePath.startsWith('/')) return BASE_PATH_WITHOUT_FIRST_SLASH
  if (basePath.endsWith('/')) return BASE_PATH_WITH_LAST_SLASH
  if (basePath.split('/').slice(1).includes('')) return BASE_PATH_WITH_EMPTY_SEGMENT
}

// In a site with localization a collection's documents have a slug and a path per locale, unless
// the collection is given with localized: false.
function resolveCollection(collection: PathCollection, { localization }: Config): PathConfig['collections'][number] {
  const { basePath, localized, parent, slug } = typeof collection === 'string' ? { slug: collection } : collection
  const resolved = { hasParent: parent !== false, localized: Boolean(localization) && localized !== false, slug }
  if (basePath === undefined) return { ...resolved, basePath: NO_BASE_PATH }
  const fault = findBasePathFault(basePath)
  if (fault) throw new Error(basePathError(basePath, slug, fault))
  return { ...resolved, basePath }
}

const resolveReserved = (segments: ReservedSegments): ReasonBySegment =>
  Array.isArray(segments) ? Object.fromEntries(segments.map((segment) => [segment, undefined])) : segments

export function resolvePathConfig(options: PathPluginOptions, config: Config): PathConfig {
  const { anyDepth = [], root } = options.reservedSegments ?? {}
  return {
    collections: options.collections.map((collection) => resolveCollection(collection, config)),
    maxDocumentsPerMove: options.maxDocumentsPerMove ?? 1_000,
    onPathsChanged: options.onPathsChanged,
    reservedSegments: { anyDepth: resolveReserved(anyDepth), root: root && resolveReserved(root) },
    rootSlug: options.rootSlug ?? 'home',
    slugify: options.slugify ?? defaultSlugify
  }
}

export function storePathConfig(custom: Record<string, unknown> | undefined, pathConfig: PathConfig) {
  return { ...custom, [CUSTOM_KEY]: pathConfig }
}

export function getPathConfig(payload: Payload): PathConfig {
  const pathConfig = payload.config.custom?.[CUSTOM_KEY] as PathConfig | undefined
  if (!pathConfig) throw new Error(PLUGIN_MISSING_ERROR)
  return pathConfig
}

// The collections a call narrows the plugin's to, or every one of them.
export function pickCollections(collections: CollectionSlug[] | undefined, pathConfig: PathConfig) {
  const given = pathConfig.collections.map(({ slug }) => slug)
  const givenSlugs = new Set<string>(given)
  const notGiven = (collections ?? []).filter((slug) => !givenSlugs.has(slug))
  if (notGiven.length > 0) throw new Error(notGivenCollectionsError(notGiven))
  return collections ?? given
}

// What the paths of a collection's top-level documents start with: its base path, or nothing.
export const getBasePath = (collectionSlug: string, { collections }: PathConfig) =>
  collections.find(({ slug }) => slug === collectionSlug)?.basePath ?? NO_BASE_PATH

// The name of the plugin's own parent field.
export const PARENT_FIELD_NAME = 'parent'

// Payload's own hierarchy gives a collection a parent field of its own, and so do its folders and
// tags presets, which Payload turns into a hierarchy when it builds the config, after the plugin ran.
export const hasPayloadHierarchy = (collection: CollectionConfig) =>
  Boolean(collection.hierarchy || collection.folders || collection.tags)

/**
 * The field a collection's documents hold their parent in: the plugin's own, or Payload's own in a
 * collection with Payload's hierarchy, by the name the running config gives it. A collection given
 * with parent: false has none: every document of it is top-level, and it stores no ancestors.
 */
export function getParentFieldName(collectionSlug: string, payload: Payload) {
  const { collections } = getPathConfig(payload)
  if (!collections.find(({ slug }) => slug === collectionSlug)?.hasParent) return undefined
  const { hierarchy } = payload.collections[collectionSlug as CollectionSlug].config
  return hierarchy ? hierarchy.parentFieldName : PARENT_FIELD_NAME
}

/**
 * Whether a collection's documents have a slug and a path per locale, which resolveCollection alone
 * decides. Where they don't, in a site without localization or in a collection given with
 * localized: false, a row holds one slug and one path, and the document is at that path in every
 * locale of the site. What reads a slug or a path off a row, writes one to a row or names one in a
 * query asks here, and nothing else knows the difference.
 */
export const isLocalized = (collectionSlug: string, payload: Payload) =>
  Boolean(getPathConfig(payload).collections.find(({ slug }) => slug === collectionSlug)?.localized)

// The field a refused parent is shown on: the plugin's own parent field. Payload's hierarchy moves a
// document with a button and has no field for the parent in the form, so there the slug shows it.
export const getParentRefusalField = (collectionSlug: string, payload: Payload) =>
  payload.collections[collectionSlug as CollectionSlug].config.hierarchy ? REFUSAL_FIELD : PARENT_FIELD_NAME

// The root segments of Payload's own routes. A route at the root has none. The routes are read from
// the running config, because the plugin gets the config before Payload fills in their defaults.
function getPayloadRootSegments({ routes }: Payload['config']): ReasonBySegment {
  const reasons = [
    [routes.admin, ADMIN_ROUTE_REASON],
    [routes.api, API_ROUTE_REASON]
  ] as const
  return Object.fromEntries(
    reasons.flatMap(([route, reason]) => {
      const segment = route.split('/').find((routeSegment) => routeSegment !== '')
      return segment === undefined ? [] : [[segment, reason]]
    })
  )
}

// What a path is refused with when one of its segments is reserved.
export function findReservedPathRefusal(path: string, payload: Payload) {
  const { anyDepth, root = getPayloadRootSegments(payload.config) } = getPathConfig(payload).reservedSegments
  const segments = path.split('/').slice(1)
  const reservedSegment = segments.find((segment) => Object.hasOwn(anyDepth, segment))
  if (reservedSegment !== undefined) return reservedAnyDepthRefusal(reservedSegment, anyDepth[reservedSegment])
  // The segment at the root, which a base path's first segment is too.
  const [rootSegment = ''] = segments
  if (Object.hasOwn(root, rootSegment)) return reservedRootRefusal(rootSegment, root[rootSegment])
}
