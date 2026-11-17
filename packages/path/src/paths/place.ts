import type { CollectionConfig, Payload } from 'payload'
import { extractID } from 'payload/shared'

import { getBasePath, getParentFieldName, getPathConfig, isLocalized, NO_BASE_PATH } from '../plugin/options.js'
import { getFallbackLocales, getLocales, valueInLocale } from './locales.js'
import { getPublishedLocales, hasDrafts } from './status.js'

export type Id = number | string

// Paths by locale, or under NO_LOCALE without localization. A locale holds null while the document
// has no path there. In a collection that isn't localized every locale holds the same path.
export type Paths = Record<string, null | string>

// Where a document hangs, and so what the paths and ancestors of everything below it start with. In
// a collection without parents it is the paths alone, and the ancestors are always empty.
export type Place = { ancestors: Id[]; paths: Paths }

// A document as the documents below it hang from it.
export type ParentPlace = Place & { id: Id }

// A document as the database adapter returns it: localized values hold every locale, and the slug
// and the path are localized where isLocalized says so. Its parent is in the field
// getParentFieldName names.
export type StoredDocument = {
  [key: string]: unknown
  _status?: unknown
  ancestors?: Id[] | null
  // Set while the document is in the trash, in a collection that has one.
  deletedAt?: unknown
  id: Id
  path?: unknown
  slug?: unknown
}

// A version as the database adapter returns it. Its own parent is the document it is a version of.
export type StoredVersion = { [key: string]: unknown; id: Id; parent: Id; version: Omit<StoredDocument, 'id'> }

// A document as the database holds it: the document itself and, in a collection with drafts, its
// latest version.
export type Stored = { document: StoredDocument; version?: StoredVersion }

// What counts for a place: the parent, and each locale's own slug.
export type PlaceRecord = { parentId: Id | null; slugs: Record<string, unknown> }

export const HOME_PAGE_PATH = '/'

export const idOf = (value: unknown): Id | null =>
  value === null || value === undefined || value === '' ? null : extractID(value as Id)

// The path a row of a collection stores, in each locale of the site.
export function readPaths(stored: unknown, collectionSlug: string, payload: Payload): Paths {
  const localized = isLocalized(collectionSlug, payload)
  return Object.fromEntries(
    getLocales(payload).map((locale) => {
      const path = valueInLocale(stored, locale, localized)
      return [locale, typeof path === 'string' ? path : null]
    })
  )
}

// The place a row of a collection stores. An empty ancestors reads as missing on MongoDB.
export const readStoredPlace = (
  { ancestors, path }: Pick<StoredDocument, 'ancestors' | 'path'>,
  collectionSlug: string,
  payload: Payload
): Place => ({ ancestors: ancestors ?? [], paths: readPaths(path, collectionSlug, payload) })

export function isSamePlace(place: Place, otherPlace: Place) {
  return (
    place.ancestors.join() === otherPlace.ancestors.join() &&
    Object.entries(place.paths).every(([locale, path]) => otherPlace.paths[locale] === path)
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
 * What counts for a document's place, or for its plan. Where a document is published, it is where it
 * was published, so there the document's own slug counts, and its own parent once it is published in
 * any locale. Where it isn't published, it is where its latest draft says. The plan is what the
 * latest version alone says. In a collection without drafts there is the document only, and in one
 * without parents no document has a parent.
 */
export function readRecord(
  { document, version }: Stored,
  kind: 'place' | 'plan',
  collection: CollectionConfig,
  payload: Payload
): PlaceRecord {
  const latest = version?.version ?? document
  const publishedLocales = kind === 'plan' ? [] : getPublishedLocales(document, collection, payload)
  const ownSlugLocales = getOwnSlugLocales(publishedLocales, collection.slug, payload)
  const localized = isLocalized(collection.slug, payload)
  const slugs = getLocales(payload).map((locale): [string, unknown] => [
    locale,
    valueInLocale((ownSlugLocales.includes(locale) ? document : latest).slug, locale, localized)
  ])
  const parentField = getParentFieldName(collection.slug, payload)
  const parentId = parentField === undefined ? null : idOf((ownSlugLocales.length > 0 ? document : latest)[parentField])
  return { parentId, slugs: Object.fromEntries(slugs) }
}

/**
 * The one rule of a place: the parent's path, a slash and the slug, below the parent's ancestors and
 * the parent. A top-level document starts at its collection's base path, and without one the root
 * slug makes it the home page. In a collection with drafts, a locale without a slug takes the one it
 * falls back to. A locale without a slug at all has no path, and neither has one the parent has no
 * path in.
 */
export function workOutPlace(
  { slugs }: PlaceRecord,
  parent: ParentPlace | null,
  collection: CollectionConfig,
  payload: Payload
): Place {
  const pathConfig = getPathConfig(payload)
  const basePath = getBasePath(collection.slug, pathConfig)
  const paths = getLocales(payload).map((locale) => {
    const slug = (hasDrafts(collection) ? getFallbackLocales(payload, locale) : [locale])
      .map((slugLocale) => slugs[slugLocale])
      .find((localeSlug) => typeof localeSlug === 'string' && localeSlug !== '')
    const parentPath = parent ? parent.paths[locale] : basePath
    if (slug === undefined || parentPath === null || parentPath === undefined) return [locale, null]
    const isHomePage = !parent && basePath === NO_BASE_PATH && slug === pathConfig.rootSlug
    return [locale, isHomePage ? HOME_PAGE_PATH : `${parentPath}/${String(slug)}`]
  })
  return { ancestors: parent ? [...parent.ancestors, parent.id] : [], paths: Object.fromEntries(paths) as Paths }
}
