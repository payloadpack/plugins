import type { CollectionConfig, Payload } from 'payload'
import { hasDraftsEnabled, hasLocalizeStatusEnabled } from 'payload/shared'

import type { StoredDocument } from '../database/documents.js'
import { getLocales, valueInLocale } from './locales.js'

/**
 * Whether a row of a collection holds a status per locale. Payload decides it per collection: one
 * per locale where the collection has a localized field, and one for every locale where it has
 * none, which a collection that isn't localized can be.
 */
export const hasStatusPerLocale = (collection: Pick<CollectionConfig, 'versions'>) => hasLocalizeStatusEnabled(collection)

/**
 * The locales a stored document, or a latest version, is published in. A collection without drafts
 * has no status, and everything in it counts as published.
 */
export function getPublishedLocales(row: Pick<StoredDocument, '_status'>, collection: CollectionConfig, payload: Payload) {
  if (!hasDraftsEnabled(collection)) return getLocales(payload)
  const perLocale = hasStatusPerLocale(collection)
  return getLocales(payload).filter((locale) => valueInLocale(row._status, locale, perLocale) === 'published')
}

// Whether a stored document is in the trash, where a collection that has one keeps a deleted document
// until it is deleted for good. There it takes no path, and keeps the path and ancestors it stores.
export const isInTrash = (document: StoredDocument) => Boolean(document.deletedAt)

// The locales a site finds a stored document in: the ones it is published in, and none from the trash.
export function getShownLocales(document: StoredDocument, collection: CollectionConfig, payload: Payload) {
  return isInTrash(document) ? [] : getPublishedLocales(document, collection, payload)
}
