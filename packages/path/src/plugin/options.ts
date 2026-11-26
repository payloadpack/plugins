import type {
  CollectionConfig,
  CollectionSlug,
  Config,
  GeneratedTypes,
  Payload,
  SingleRelationshipField,
  TextField,
  TextFieldSingleValidation
} from 'payload'
import type { Slugify } from 'payload/shared'

import type { PathsChangedArgs } from '../hooks/paths-change.js'
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

// The property of the site's generated Config that holds the slugs of the plugin's collections.
const GENERATED_TYPES_KEY = 'pathCollectionSlug'

/**
 * The slug of a collection given to the plugin, as the types `payload generate:types` writes name
 * them once the plugin is in the config. Before that, the slug of any collection.
 */
export type PathCollectionSlug =
  GeneratedTypes extends Record<typeof GENERATED_TYPES_KEY, infer Slug extends CollectionSlug> ? Slug : CollectionSlug

type TypescriptSchema = NonNullable<NonNullable<Config['typescript']>['schema']>[number]

/** Adds the slugs of the plugin's collections to the types `payload generate:types` writes, for PathCollectionSlug. */
export const buildTypescriptSchema =
  (slugs: CollectionSlug[]): TypescriptSchema =>
  ({ jsonSchema }) => ({
    ...jsonSchema,
    properties: { ...jsonSchema.properties, [GENERATED_TYPES_KEY]: { enum: slugs, type: 'string' } },
    required: [...(Array.isArray(jsonSchema.required) ? jsonSchema.required : []), GENERATED_TYPES_KEY]
  })

/** What sets a collection whose documents get a path apart, given to withPath or with its slug in collections. */
export type PathCollectionOptions = {
  /** What the paths of its top-level documents start with, such as /blog. Without one they start at the root. */
  basePath?: string
  /**
   * true when, in a site with localization, its documents have a slug and a path per locale. Without
   * it they have one slug and one path, the same in every locale.
   */
  localized?: true
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
)

/** A collection whose documents get a path: its slug alone, or its slug with what sets the collection apart. */
export type PathCollection = CollectionSlug | (PathCollectionOptions & { slug: CollectionSlug })

export type PathPluginOptions = {
  /**
   * The collections whose documents get a path, beside the ones wrapped in withPath. Each one's
   * documents sit below documents of its own, by the plugin's parent field, or by Payload's own where
   * the collection has Payload's hierarchy.
   */
  collections?: PathCollection[]
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
   * Runs after a save or a delete that changed where a site finds a published document, so a site
   * purges its own cache and keeps its redirects.
   */
  onPathsChanged?: (args: PathsChangedArgs) => Promise<void> | void
}

type PathConfig = {
  collections: { basePath: string; hasParent: boolean; localized: boolean; slug: CollectionSlug }[]
  onPathsChanged?: PathPluginOptions['onPathsChanged']
  // Without root, Payload's own routes count.
  reservedSegments: { anyDepth: ReasonBySegment; root?: ReasonBySegment }
  rootSlug: string
  slugify: Slugify
}

export type ReasonBySegment = Record<string, string | undefined>

// Each entry in a custom is named for what writes it: withPath in a collection's, pathRelationshipField
// in a field's, pathPlugin() in the config's.
/** The key withPath keeps a collection's options under, in the collection's custom. */
export const WITH_PATH_KEY = 'withPath'
export const PATH_RELATIONSHIP_FIELD_KEY = 'pathRelationshipField'
const PATH_PLUGIN_KEY = 'pathPlugin'

export const NO_BASE_PATH = ''

// A base path stands where a parent's path would, so it takes the same shape: a slash before each
// segment and none at the end.
function getBasePathFault(basePath: string) {
  if (basePath === '/' || basePath === '') return BASE_PATH_IS_ROOT
  if (!basePath.startsWith('/')) return BASE_PATH_WITHOUT_FIRST_SLASH
  if (basePath.endsWith('/')) return BASE_PATH_WITH_LAST_SLASH
  if (basePath.split('/').slice(1).includes('')) return BASE_PATH_WITH_EMPTY_SEGMENT
}

function resolveCollection(collection: PathCollection, { localization }: Config): PathConfig['collections'][number] {
  const { basePath, localized, parent, slug } = typeof collection === 'string' ? { slug: collection } : collection
  // Localized only when given with localized: true, so a site that gets localization later keeps the
  // slugs and paths it stores.
  const resolved = { hasParent: parent !== false, localized: Boolean(localization) && localized === true, slug }
  if (basePath === undefined) return { ...resolved, basePath: NO_BASE_PATH }
  const fault = getBasePathFault(basePath)
  if (fault) throw new Error(basePathError(basePath, slug, fault))
  return { ...resolved, basePath }
}

const resolveReserved = (segments: ReservedSegments): ReasonBySegment =>
  Array.isArray(segments) ? Object.fromEntries(segments.map((segment) => [segment, undefined])) : segments

// A collection gets a path in the plugin's collections or wrapped in withPath, which keeps what sets it
// apart in the collection's own custom, the one Payload keeps on the server.
export function getPathCollections({ collections = [] }: PathPluginOptions, config: Config): PathCollection[] {
  const wrappedCollections = (config.collections ?? []).flatMap(({ custom, slug }) =>
    custom?.[WITH_PATH_KEY] ? [{ ...(custom[WITH_PATH_KEY] as PathCollectionOptions), slug }] : []
  )
  return [...collections, ...wrappedCollections]
}

export function resolvePathConfig(options: PathPluginOptions, pathCollections: PathCollection[], config: Config): PathConfig {
  const { anyDepth = [], root } = options.reservedSegments ?? {}
  return {
    collections: pathCollections.map((collection) => resolveCollection(collection, config)),
    onPathsChanged: options.onPathsChanged,
    reservedSegments: { anyDepth: resolveReserved(anyDepth), root: root && resolveReserved(root) },
    rootSlug: options.rootSlug ?? 'home',
    slugify: options.slugify ?? defaultSlugify
  }
}

export type FieldOptions = { parentField?: ParentFieldOptions; slugField?: SlugFieldOptions }

// Only building the slug field and the parent field reads these, so the stored config doesn't hold them.
export function getFieldOptions(collectionSlug: string, pathCollections: PathCollection[]): FieldOptions {
  const pathCollection = pathCollections.find(
    (collection) => typeof collection !== 'string' && collection.slug === collectionSlug
  )
  return typeof pathCollection === 'object'
    ? { parentField: pathCollection.parentField, slugField: pathCollection.slugField }
    : {}
}

export function storePathConfig(custom: Record<string, unknown> | undefined, pathConfig: PathConfig) {
  return { ...custom, [PATH_PLUGIN_KEY]: pathConfig }
}

// A plugin after pathPlugin(), a field's config function and a running Payload all read the config
// it kept.
function getStoredPathConfig({ custom }: Pick<Config, 'custom'>): PathConfig {
  const pathConfig = custom?.[PATH_PLUGIN_KEY] as PathConfig | undefined
  if (!pathConfig) throw new Error(PLUGIN_MISSING_ERROR)
  return pathConfig
}

export function getPathConfig(payload: Payload): PathConfig {
  return getStoredPathConfig(payload.config)
}

/**
 * The slugs of the plugin's collections, listed in collections or wrapped in withPath, from a config
 * pathPlugin() has run on: the one a plugin after it gets, the one a field's config function gets,
 * or payload.config.
 */
export function getPathCollectionSlugs(config: Pick<Config, 'custom'>): PathCollectionSlug[] {
  return getStoredPathConfig(config).collections.map(({ slug }) => slug as PathCollectionSlug)
}

export function pickCollections(collections: CollectionSlug[] | undefined, pathConfig: PathConfig) {
  const given = pathConfig.collections.map(({ slug }) => slug)
  const givenSlugs = new Set<string>(given)
  const notGiven = (collections ?? []).filter((slug) => !givenSlugs.has(slug))
  if (notGiven.length > 0) throw new Error(notGivenCollectionsError(notGiven))
  return collections ?? given
}

export const getCollection = (collectionSlug: string, { collections }: PathConfig) =>
  collections.find(({ slug }) => slug === collectionSlug)

export const getBasePath = (collectionSlug: string, payload: Payload) =>
  getCollection(collectionSlug, getPathConfig(payload))?.basePath ?? NO_BASE_PATH

export const PARENT_FIELD_NAME = 'parent'

// Payload turns the folders and tags presets into a hierarchy when it builds the config, after the
// plugin ran.
export const hasPayloadHierarchy = (collection: CollectionConfig) =>
  Boolean(collection.hierarchy || collection.folders || collection.tags)

export function getParentFieldName(collectionSlug: string, payload: Payload) {
  if (!getCollection(collectionSlug, getPathConfig(payload))?.hasParent) return undefined
  // The running config, which names the parent field of Payload's hierarchy.
  const { hierarchy } = payload.collections[collectionSlug as CollectionSlug].config
  return hierarchy ? hierarchy.parentFieldName : PARENT_FIELD_NAME
}

// What reads a slug or a path off a row, writes one to a row or names one in a query asks here, and
// nothing else knows the difference.
export const isLocalized = (collectionSlug: string, payload: Payload) =>
  Boolean(getCollection(collectionSlug, getPathConfig(payload))?.localized)

// Payload's hierarchy moves a document with a button and has no field for the parent in the form, so
// there the slug shows a refused parent.
export const getParentRefusalField = (collectionSlug: string, payload: Payload) =>
  payload.collections[collectionSlug as CollectionSlug].config.hierarchy ? REFUSAL_FIELD : PARENT_FIELD_NAME
