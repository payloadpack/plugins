import type {
  CollectionConfig,
  CollectionSlug,
  Config,
  Payload,
  PayloadRequest,
  SingleRelationshipField,
  TextField,
  TextFieldSingleValidation
} from 'payload'
import type { Slugify } from 'payload/shared'

import type { PathsChange } from '../hooks/paths-change.js'
import {
  BASE_PATH_IS_ROOT,
  BASE_PATH_WITH_EMPTY_SEGMENT,
  BASE_PATH_WITH_LAST_SLASH,
  BASE_PATH_WITHOUT_FIRST_SLASH,
  basePathError,
  notGivenCollectionsError,
  PLUGIN_MISSING_ERROR,
  REFUSAL_FIELD
} from './messages.js'
import { defaultSlugify } from './slugify.js'

/**
 * Reserved segments as a list, or each with a reason that is shown when a slug is refused: at the
 * root what the site serves there, and at any depth what the segment means in a path.
 */
export type ReservedSegments = Record<string, string> | string[]

/**
 * What a site sets on the plugin's slug field, as on Payload's own text field. Its access, label and
 * validate are used as given, its admin goes over the plugin's own, and its hooks run after the
 * plugin's own.
 */
export type SlugFieldOptions = Pick<TextField, 'access' | 'admin' | 'hooks' | 'label'> & {
  validate?: TextFieldSingleValidation
}

/**
 * What a site sets on the plugin's parent field, as on Payload's own relationship field. Its access,
 * hooks and label are used as given, its admin goes over the plugin's own, and its filterOptions
 * holds together with the plugin's own.
 */
export type ParentFieldOptions = Pick<SingleRelationshipField, 'access' | 'admin' | 'filterOptions' | 'hooks' | 'label'>

/** A collection whose documents get a path: its slug alone, or its slug with what sets the collection apart. */
export type PathCollection =
  | CollectionSlug
  | ({
      /** What the paths of its top-level documents start with, such as /blog. Without one they start at the root. */
      basePath?: string
      /**
       * true when, in a site with localization, its documents have a slug and a path per locale. Without
       * it they have one slug and one path, the same in every locale.
       */
      localized?: true
      slug: CollectionSlug
      /** What the site sets on the slug field. */
      slugField?: SlugFieldOptions
    } & (
      | {
          parent?: never
          /** What the site sets on the plugin's own parent field, which a collection with Payload's hierarchy doesn't get. */
          parentField?: ParentFieldOptions
        }
      | {
          /** false when its documents have no parent, so each one's path is the base path, a slash and its slug. */
          parent: false
          parentField?: never
        }
    ))

export type PathPluginOptions = {
  /**
   * The collections whose documents get a path. Each one's documents sit below documents of its own,
   * by the plugin's parent field, or by Payload's own where the collection has Payload's hierarchy.
   */
  collections: PathCollection[]
  /**
   * The top-level document with this slug, in a collection without a base path, is the home page and
   * answers /. Defaults to 'home'.
   */
  rootSlug?: string
  /**
   * Segments a path can't use, at the root and at any depth. Without root, the root segments of
   * Payload's admin and API routes are reserved, and a root that is given is the whole list.
   */
  reservedSegments?: { anyDepth?: ReservedSegments; root?: ReservedSegments }
  /**
   * Makes a slug from a title and from what an editor typed, in the shape of the slugify of Payload's
   * own slug field. Defaults to defaultSlugify, which takes the accents off Latin letters and keeps
   * the letters of other scripts.
   */
  slugify?: Slugify
  /**
   * Runs after a save or a delete that changed a published path or moved a branch, so a site purges
   * its own cache and keeps its redirects.
   */
  onPathsChanged?: (change: PathsChange, req: PayloadRequest) => Promise<void> | void
}

// The options with every default filled in, as the plugin stores them on the Payload config.
type PathConfig = {
  // Each collection with its base path, which is empty without one, whether its documents have a
  // parent, and whether they have a slug and a path per locale.
  collections: { basePath: string; hasParent: boolean; localized: boolean; slug: CollectionSlug }[]
  onPathsChanged?: PathPluginOptions['onPathsChanged']
  // Each reserved segment with its reason, if it has one. Without root, Payload's own routes count.
  reservedSegments: { anyDepth: ReasonBySegment; root?: ReasonBySegment }
  rootSlug: string
  slugify: Slugify
}

export type ReasonBySegment = Record<string, string | undefined>

const CUSTOM_KEY = 'payloadpackPath'

// Without a base path, a top-level document's path starts with nothing, so it sits at the root.
export const NO_BASE_PATH = ''

// A base path stands where a parent's path would, so it takes the same shape: a slash before each
// segment and none at the end.
function getBasePathFault(basePath: string) {
  if (basePath === '/' || basePath === '') return BASE_PATH_IS_ROOT
  if (!basePath.startsWith('/')) return BASE_PATH_WITHOUT_FIRST_SLASH
  if (basePath.endsWith('/')) return BASE_PATH_WITH_LAST_SLASH
  if (basePath.split('/').slice(1).includes('')) return BASE_PATH_WITH_EMPTY_SEGMENT
}

// A collection's documents have one slug and one path, the same in every locale, unless the site
// has localization and the collection is given with localized: true. So a site that gets
// localization later keeps the slugs and paths it stores.
function resolveCollection(collection: PathCollection, { localization }: Config): PathConfig['collections'][number] {
  const { basePath, localized, parent, slug } = typeof collection === 'string' ? { slug: collection } : collection
  const resolved = { hasParent: parent !== false, localized: Boolean(localization) && localized === true, slug }
  if (basePath === undefined) return { ...resolved, basePath: NO_BASE_PATH }
  const fault = getBasePathFault(basePath)
  if (fault) throw new Error(basePathError(basePath, slug, fault))
  return { ...resolved, basePath }
}

const resolveReserved = (segments: ReservedSegments): ReasonBySegment =>
  Array.isArray(segments) ? Object.fromEntries(segments.map((segment) => [segment, undefined])) : segments

export function resolvePathConfig(options: PathPluginOptions, config: Config): PathConfig {
  const { anyDepth = [], root } = options.reservedSegments ?? {}
  return {
    collections: options.collections.map((collection) => resolveCollection(collection, config)),
    onPathsChanged: options.onPathsChanged,
    reservedSegments: { anyDepth: resolveReserved(anyDepth), root: root && resolveReserved(root) },
    rootSlug: options.rootSlug ?? 'home',
    slugify: options.slugify ?? defaultSlugify
  }
}

export type FieldOptions = { parentField?: ParentFieldOptions; slugField?: SlugFieldOptions }

// What a site sets on a collection's slug field and parent field, which only building those fields
// reads, so the stored config doesn't hold it.
export function getFieldOptions(collectionSlug: string, { collections }: PathPluginOptions): FieldOptions {
  const given = collections.find((collection) => typeof collection !== 'string' && collection.slug === collectionSlug)
  return typeof given === 'object' ? { parentField: given.parentField, slugField: given.slugField } : {}
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

// A collection as the plugin was given it, with every default filled in, or nothing for a
// collection it wasn't given.
export const getCollection = (collectionSlug: string, { collections }: PathConfig) =>
  collections.find(({ slug }) => slug === collectionSlug)

// What the paths of a collection's top-level documents start with: its base path, or nothing.
export const getBasePath = (collectionSlug: string, payload: Payload) =>
  getCollection(collectionSlug, getPathConfig(payload))?.basePath ?? NO_BASE_PATH

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
  if (!getCollection(collectionSlug, getPathConfig(payload))?.hasParent) return undefined
  const { hierarchy } = payload.collections[collectionSlug as CollectionSlug].config
  return hierarchy ? hierarchy.parentFieldName : PARENT_FIELD_NAME
}

/**
 * Whether a collection's documents have a slug and a path per locale, which resolveCollection alone
 * decides. Where they don't, a row holds one slug and one path, and the document is at that path in
 * every locale of the site. What reads a slug or a path off a row, writes one to a row or names one
 * in a query asks here, and nothing else knows the difference.
 */
export const isLocalized = (collectionSlug: string, payload: Payload) =>
  Boolean(getCollection(collectionSlug, getPathConfig(payload))?.localized)

// The field a refused parent is shown on: the plugin's own parent field. Payload's hierarchy moves a
// document with a button and has no field for the parent in the form, so there the slug shows it.
export const getParentRefusalField = (collectionSlug: string, payload: Payload) =>
  payload.collections[collectionSlug as CollectionSlug].config.hierarchy ? REFUSAL_FIELD : PARENT_FIELD_NAME
