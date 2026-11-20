import type { CollectionConfig, Payload } from 'payload'
import { hasDraftsEnabled, hasLocalizeStatusEnabled } from 'payload/shared'

import type { StoredDocument } from '../database/documents.js'
import { getLocales, valueInLocale } from './locales.js'

// Payload's own answer per collection, not the plugin's localized: one per locale where the collection
// has a localized field, and one for every locale where it has none.
export const hasStatusPerLocale = (collection: Pick<CollectionConfig, 'versions'>) => hasLocalizeStatusEnabled(collection)

export function getPublishedLocales(row: Pick<StoredDocument, '_status'>, collection: CollectionConfig, payload: Payload) {
  // A collection without drafts has no status, and everything in it counts as published.
  if (!hasDraftsEnabled(collection)) return getLocales(payload)
  const perLocale = hasStatusPerLocale(collection)
  return getLocales(payload).filter((locale) => valueInLocale(row._status, locale, perLocale) === 'published')
}

export const isInTrash = (document: StoredDocument) => Boolean(document.deletedAt)

export function getShownLocales(document: StoredDocument, collection: CollectionConfig, payload: Payload) {
  return isInTrash(document) ? [] : getPublishedLocales(document, collection, payload)
}
