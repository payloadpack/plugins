import type { CollectionConfig, Payload } from 'payload'
import { extractID, hasDraftsEnabled } from 'payload/shared'

import type { StoredDocument } from '../database/documents.js'
import type { DocumentAndLatestVersion } from '../database/versions.js'
import { getBasePath, getParentFieldName, getPathConfig, isLocalized, NO_BASE_PATH } from '../plugin/options.js'
import { getFallbackLocales, getLocales, valueInLocale } from '../utils/locales.js'
import { getPublishedLocales } from '../utils/published-locales.js'

export type Id = number | string

// Paths by locale, or under NO_LOCALE without localization. A locale holds null while the document
// has no path there. In a collection that isn't localized every locale holds the same path.
export type Paths = Record<string, null | string>

// One path, with the locale it is a document's path in.
export type LocalePath = [locale: string, path: string]

// Where a document hangs, and so what the paths and ancestors of everything below it start with. In
// a collection without parents it is the paths alone, and the ancestors are always empty.
export type PathAndAncestors = { ancestors: Id[]; paths: Paths }

// A document as the documents below it hang from it.
export type ParentPathAndAncestors = PathAndAncestors & { id: Id }

// What a path and ancestors are made from: the parent, and each locale's own slug.
export type SlugsAndParent = { parentId: Id | null; slugs: Record<string, unknown> }

export const HOME_PAGE_PATH = '/'

export const idOf = (value: unknown): Id | null =>
  value === null || value === undefined || value === '' ? null : extractID(value as Id)

// What the rule of a path takes for a slug: a string that isn't empty.
export const isSlug = (value: unknown): value is string => typeof value === 'string' && value !== ''

// The path a row of a collection stores, in each locale of the site.
export function getPaths(stored: unknown, collectionSlug: string, payload: Payload): Paths {
  const localized = isLocalized(collectionSlug, payload)
  return Object.fromEntries(
    getLocales(payload).map((locale) => {
      const path = valueInLocale(stored, locale, localized)
      return [locale, typeof path === 'string' ? path : null]
    })
  )
}

// The path and ancestors a row of a collection stores. An empty ancestors reads as missing on MongoDB.
export const getStoredPathAndAncestors = (
  { ancestors, path }: Pick<StoredDocument, 'ancestors' | 'path'>,
  collectionSlug: string,
  payload: Payload
): PathAndAncestors => ({ ancestors: ancestors ?? [], paths: getPaths(path, collectionSlug, payload) })

export function hasSamePathAndAncestors(one: PathAndAncestors, other: PathAndAncestors) {
  return (
    one.ancestors.join() === other.ancestors.join() &&
    Object.entries(one.paths).every(([locale, path]) => other.paths[locale] === path)
  )
}

export function hasSameSlugsAndParent(one: SlugsAndParent, other: SlugsAndParent) {
  return (
    String(one.parentId) === String(other.parentId) &&
    Object.entries(one.slugs).every(([locale, slug]) => other.slugs[locale] === slug)
  )
}

/**
 * The locales a document's own slug counts in, from the locales it is published in, or a site finds
 * it in: those, and in a collection that isn't localized every locale once there is one, because its
 * one slug has one answer for every locale, as its parent has.
 */
export const getOwnSlugLocales = (locales: string[], collectionSlug: string, payload: Payload) =>
  isLocalized(collectionSlug, payload) || locales.length === 0 ? locales : getLocales(payload)

/**
 * What counts for a document's path and ancestors, or for the ones its latest draft would give it.
 * Where a document is published, it is where it was published, so there the document's own slug
 * counts, and its own parent once it is published in any locale. Where it isn't published, it is
 * where its latest draft says. For the draft's, only what the latest version says counts. In a
 * collection without drafts there is the document only, and in one without parents no document has a
 * parent.
 */
export function getSlugsAndParent(
  { document, version }: DocumentAndLatestVersion,
  kind: 'document' | 'draft',
  collection: CollectionConfig,
  payload: Payload
): SlugsAndParent {
  const latest = version?.version ?? document
  const publishedLocales = kind === 'draft' ? [] : getPublishedLocales(document, collection, payload)
  const ownSlugLocales = new Set(getOwnSlugLocales(publishedLocales, collection.slug, payload))
  const localized = isLocalized(collection.slug, payload)
  const slugs = getLocales(payload).map((locale): [string, unknown] => [
    locale,
    valueInLocale((ownSlugLocales.has(locale) ? document : latest).slug, locale, localized)
  ])
  const parentField = getParentFieldName(collection.slug, payload)
  const parentId = parentField === undefined ? null : idOf((ownSlugLocales.size > 0 ? document : latest)[parentField])
  return { parentId, slugs: Object.fromEntries(slugs) }
}

// What the paths of the documents right below a parent start with, in each locale: the parent's
// path, or at the top level the collection's base path.
function getParentPaths(parent: PathAndAncestors | null, collectionSlug: string, payload: Payload): Paths {
  if (parent) return parent.paths
  const basePath = getBasePath(collectionSlug, payload)
  return Object.fromEntries(getLocales(payload).map((locale) => [locale, basePath]))
}

/**
 * The one rule of a path and its ancestors: the parent's path, a slash and the slug, below the
 * parent's ancestors and the parent. A top-level document starts at its collection's base path, and
 * without one the root slug makes it the home page. In a collection with drafts, a locale without a
 * slug takes the one it falls back to. A locale without a slug at all has no path, and neither has
 * one the parent has no path in.
 */
export function buildPathAndAncestors(
  slugs: SlugsAndParent['slugs'],
  parent: ParentPathAndAncestors | null,
  collection: CollectionConfig,
  payload: Payload
): PathAndAncestors {
  const { rootSlug } = getPathConfig(payload)
  const parentPaths = getParentPaths(parent, collection.slug, payload)
  const paths = getLocales(payload).map((locale) => {
    const slug = (hasDraftsEnabled(collection) ? getFallbackLocales(payload, locale) : [locale])
      .map((slugLocale) => slugs[slugLocale])
      .find(isSlug)
    const parentPath = parentPaths[locale]
    if (slug === undefined || parentPath === null || parentPath === undefined) return [locale, null]
    const isHomePage = !parent && parentPath === NO_BASE_PATH && slug === rootSlug
    return [locale, isHomePage ? HOME_PAGE_PATH : `${parentPath}/${slug}`]
  })
  return { ancestors: parent ? [...parent.ancestors, parent.id] : [], paths: Object.fromEntries(paths) as Paths }
}
