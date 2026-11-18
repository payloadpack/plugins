import type { CollectionConfig, PayloadRequest } from 'payload'

import type { StoredDocument } from '../database/documents.js'
import type { PathAndAncestors } from '../path/build-path-and-ancestors.js'
import { buildFieldError, MISSING_SLUG_REFUSAL, REFUSAL_FIELD } from '../plugin/messages.js'
import { getPublishedLocales, hasDrafts } from '../utils/published-locales.js'

/**
 * Refuses a document that is published in a locale it has no path in. In a collection with drafts
 * every locale falls back to a slug, so such a document has no slug in any locale. Which locales a
 * save published is known only once Payload has written it.
 */
export function checkPublishedPaths(
  collection: CollectionConfig,
  document: StoredDocument,
  { paths }: PathAndAncestors,
  req: PayloadRequest
) {
  if (!hasDrafts(collection)) return
  const withoutPath = getPublishedLocales(document, collection, req.payload).find((locale) => paths[locale] === null)
  if (withoutPath !== undefined) throw buildFieldError(collection.slug, REFUSAL_FIELD, MISSING_SLUG_REFUSAL, req, withoutPath)
}
