import type { CollectionSlug, Payload, PayloadRequest, SanitizedCollectionConfig } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import type { DocumentAndLatestVersion } from '../database/versions.js'
import type { Id, PathAndAncestors, Paths } from '../path/build-path-and-ancestors.js'
import type { BranchMove } from '../path/move-branch.js'
import { getPathConfig, isLocalized } from '../plugin/options.js'
import { getSaved, inLocale, NO_LOCALE } from '../utils/locales.js'
import { getPublishedLocales, getShownLocales, hasStatusPerLocale } from '../utils/published-locales.js'
import type { PathAndAncestorsBefore } from './context.js'

/**
 * Where a site finds one document, before and now, in the locale the paths belong to. Without
 * localization there is no locale.
 */
export type ChangedPath = {
  /** The collection the document is in. */
  collection: string
  /** The document's id. */
  id: Id
  locale?: string
  /** The path a site found the document at before, or null when it found it at none. */
  from: null | string
  /** The path a site finds the document at now, or null when it finds it at none. */
  to: null | string
}

/** What onPathsChanged is given after a save or a delete. */
export type PathsChangedArgs = {
  /**
   * Each document a site finds at another path than before, per locale: the saved or deleted
   * document first, then each published document below it, top-down. A publish has no from, an
   * unpublish, a delete and a document sent to the trash have no to, and a publish that keeps the
   * path has the same from and to.
   */
  changedPaths: ChangedPath[]
  /** The Payload instance. */
  payload: Payload
  /** The request of the save or the delete, to pass on to what the function writes. */
  req: PayloadRequest
}

export const changedPath = (collection: string, id: Id, locale: string, from: null | string, to: null | string): ChangedPath => ({
  collection,
  id,
  ...inLocale(locale),
  from,
  to
})

export function getChangedPathsBelow({ collection, documents }: BranchMove, payload: Payload): ChangedPath[] {
  const { config } = payload.collections[collection as CollectionSlug]
  return documents.flatMap(({ document, pathAndAncestors, storedPaths }) =>
    getShownLocales(document, config, payload).flatMap((locale) => {
      const [from, to] = [storedPaths[locale], pathAndAncestors.paths[locale]]
      return typeof from === 'string' && typeof to === 'string' && to !== from
        ? [changedPath(collection, document.id, locale, from, to)]
        : []
    })
  )
}

// A lift of a document further up can move a document again after another lift moved it, and Payload
// starts the hooks after the deletes all at once, so the site may hear the lifts in any order. So each
// lifted document is named where the last lift of the same bulk delete put it.
export function withLastLandings(changedPaths: ChangedPath[], landings: Map<string, Paths>): ChangedPath[] {
  return changedPaths.flatMap((changed) => {
    // The deleted document's own paths have no to, and stay as they are: an earlier lift may have moved
    // that document too.
    if (changed.to === null) return [changed]
    const to = landings.get(String(changed.id))?.[changed.locale ?? NO_LOCALE] ?? changed.to
    return to === changed.from ? [] : [{ ...changed, to }]
  })
}

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
): ChangedPath[] {
  const { payload } = req
  // A save publishes in the locales it holds a status of, and in a collection without drafts, which
  // has none, in the ones it holds a slug of.
  const publishesPerLocale = hasDraftsEnabled(collection) ? hasStatusPerLocale(collection) : isLocalized(collection.slug, payload)
  const savedLocales = new Set(getSaved(req, publishesPerLocale).savedLocales)
  const publishedLocales = new Set(getPublishedLocales(stored.version?.version ?? stored.document, collection, payload))
  const shownLocales = new Set(getShownLocales(stored.document, collection, payload))
  const shownLocalesBefore = new Set(before?.shownLocales)
  const shownBefore = (locale: string) => (shownLocalesBefore.has(locale) ? before?.paths[locale] : null) ?? null
  const shownNow = (locale: string) => (shownLocales.has(locale) ? pathAndAncestors.paths[locale] : null) ?? null
  return [...new Set([...shownLocales, ...shownLocalesBefore])].flatMap((locale) => {
    const [from, to] = [shownBefore(locale), shownNow(locale)]
    // The save published the document in a locale it publishes in when it left no draft there.
    const published = to !== null && savedLocales.has(locale) && publishedLocales.has(locale)
    return from !== to || published ? [changedPath(collection.slug, stored.document.id, locale, from, to)] : []
  })
}

export async function reportChangedPaths(changedPaths: ChangedPath[], req: PayloadRequest) {
  if (changedPaths.length === 0) return
  await getPathConfig(req.payload).onPathsChanged?.({ changedPaths, payload: req.payload, req })
}
