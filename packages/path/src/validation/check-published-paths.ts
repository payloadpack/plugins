import type { CollectionConfig, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import type { StoredDocument } from '../database/documents.js'
import type { PathAndAncestors } from '../path/build-path-and-ancestors.js'
import { buildFieldError, MISSING_SLUG_REFUSAL, REFUSAL_FIELD } from '../plugin/messages.js'
import { getPublishedLocales } from '../utils/published-locales.js'

// With drafts every locale falls back to a slug, so a published locale without a path means no slug in
// any locale. The hook before the write refuses that from the save and the stored slugs, and this
// checks what only Payload's write decides: which locales the save published, and the slugs it holds
// there.
export function checkPublishedPaths(
  collection: CollectionConfig,
  document: StoredDocument,
  { paths }: PathAndAncestors,
  req: PayloadRequest
) {
  if (!hasDraftsEnabled(collection)) return
  const withoutPath = getPublishedLocales(document, collection, req.payload).find((locale) => paths[locale] === null)
  if (withoutPath !== undefined) throw buildFieldError(collection.slug, REFUSAL_FIELD, MISSING_SLUG_REFUSAL, req, withoutPath)
}
