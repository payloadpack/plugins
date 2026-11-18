import type { CollectionSlug, Payload, PayloadRequest, SanitizedCollectionConfig } from 'payload'
import { hasLocalizeStatusEnabled } from 'payload/shared'

import type { DocumentAndLatestVersion } from '../database/versions.js'
import type { Id, PathAndAncestors, Paths } from '../path/build-path-and-ancestors.js'
import type { BranchMove } from '../path/move-branch.js'
import { isLocalized } from '../plugin/options.js'
import { getSaved, NO_LOCALE } from '../utils/locales.js'
import { getPublishedLocales, getShownLocales, hasDrafts } from '../utils/published-locales.js'
import type { PathAndAncestorsBefore } from './context.js'

/** A path that shows something else, in the locale it belongs to. Without localization there is no locale. */
export type ChangedPath = { locale?: string; path: string }

/** Where the documents below a document went, so a site can redirect them. */
export type BranchChange = {
  /** The collection the document is in. */
  collection: string
  /** The document that moved, or the deleted document whose documents below were lifted. */
  id: Id
  /** How many documents sit below it. */
  documentsBelow: number
  /**
   * Per locale that changed: every path that started with from and a slash now starts with to and a
   * slash. For a move they are the document's own paths. For a lift, from is the deleted document's
   * path and to what was above it: its parent's path, the base path, or nothing at the root.
   */
  paths: { from: string; locale?: string; to: string }[]
  /**
   * Each document below that a site finds at another path now, top-down: the path it was at and the
   * path it is at, per locale it is published in and has another path in. A document below that is
   * published in no locale is not among them.
   */
  documents: { id: Id; paths: { from: string; locale?: string; to: string }[] }[]
}

/** What onPathsChanged hears after a save or a delete. */
export type PathsChange = {
  /**
   * Each published path that shows something else: the path of a publish, the path a document was
   * published at and left or was unpublished at, and the path of a deleted or trashed document.
   */
  paths: ChangedPath[]
  /** A save that moved a document with a path, also with nothing below it. */
  moved?: BranchChange
  /** A delete that lifted the documents below the deleted document. */
  lifted?: BranchChange
}

const inLocale = (locale: string) => (locale === NO_LOCALE ? {} : { locale })

export const changedPath = (locale: string, path: string): ChangedPath => ({ ...inLocale(locale), path })

// The paths of these locales that are other ones now. A locale without a path before or now has none.
const getMovedPaths = (locales: string[], from: Paths, to: Paths) =>
  locales.flatMap((locale) => {
    const [path, newPath] = [from[locale], to[locale]]
    return typeof path === 'string' && typeof newPath === 'string' && newPath !== path
      ? [{ ...inLocale(locale), from: path, to: newPath }]
      : []
  })

// Where a branch went and each document below with it, from the rows the move held before it wrote
// them, or nothing when the branch starts with another path in no locale.
export function getBranchChange(
  { below: { length: documentsBelow }, collection, documents }: BranchMove,
  id: Id,
  from: Paths,
  to: Paths,
  payload: Payload
): BranchChange | undefined {
  const paths = getMovedPaths(Object.keys(from), from, to)
  if (paths.length === 0) return undefined
  const { config } = payload.collections[collection as CollectionSlug]
  // Only the locales a site finds a document in count, by the rule a save's own paths follow.
  const below = documents.flatMap(({ document, pathAndAncestors, storedPaths }) => {
    const movedPaths = getMovedPaths(getShownLocales(document, config, payload), storedPaths, pathAndAncestors.paths)
    return movedPaths.length > 0 ? [{ id: document.id, paths: movedPaths }] : []
  })
  return { collection, documents: below, documentsBelow, id, paths }
}

// Which paths show something else after a save, from where a site found the document before the write
// and where it finds it after: each path it finds it at now and didn't before, or that the save
// published it at, and each path it found it at before and doesn't now.
export function getChangedPaths(
  {
    collection,
    pathAndAncestors,
    req,
    stored
  }: {
    collection: SanitizedCollectionConfig
    pathAndAncestors: PathAndAncestors
    req: PayloadRequest
    stored: DocumentAndLatestVersion
  },
  before: PathAndAncestorsBefore | undefined
) {
  const { payload } = req
  // A save publishes in the locales it holds a status of, and in a collection without drafts, which
  // has none, in the ones it holds a slug of.
  const publishesPerLocale = hasDrafts(collection) ? hasLocalizeStatusEnabled(collection) : isLocalized(collection.slug, payload)
  const savedLocales = new Set(getSaved(req, publishesPerLocale).savedLocales)
  const publishedLocales = new Set(getPublishedLocales(stored.version?.version ?? stored.document, collection, payload))
  const shownLocales = new Set(getShownLocales(stored.document, collection, payload))
  const shownLocalesBefore = new Set(before?.shownLocales)
  const shownBefore = (locale: string) => (shownLocalesBefore.has(locale) ? before?.paths[locale] : null) ?? null
  const shownNow = (locale: string) => (shownLocales.has(locale) ? pathAndAncestors.paths[locale] : null) ?? null
  const changedPaths: ChangedPath[] = []
  for (const locale of shownLocales) {
    const path = shownNow(locale)
    // The save published the document in a locale it publishes in when it left no draft there.
    const published = savedLocales.has(locale) && publishedLocales.has(locale)
    if (path && (published || shownBefore(locale) !== path)) changedPaths.push(changedPath(locale, path))
  }
  for (const locale of shownLocalesBefore) {
    const path = shownBefore(locale)
    if (path && path !== shownNow(locale)) changedPaths.push(changedPath(locale, path))
  }
  return changedPaths
}
