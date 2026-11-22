import type { CollectionAfterDeleteHook } from 'payload'

import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { buildDocumentKey, TARGET_DOCUMENT_KEY_FIELD_NAME } from '../fields/target-document-key.js'
import { TYPE_FIELD_NAME } from '../fields/type.js'
import { getRedirectsConfig } from './options.js'

/**
 * Deletes the suggestions to a document once it is deleted: they send nobody, and Yes would turn on a
 * redirect to nothing. After the delete, so a document whose delete fails, alone or in a bulk delete,
 * keeps them, and through the delete's req, so they roll back with it. A suggestion a site's own hook
 * refuses to delete stays, as it would without this hook, and the document's delete stands. An
 * editor's redirect to the document, On or Off, stays and sends nobody, and a document moved to the
 * trash keeps its suggestions until it is deleted from there.
 */
export const deleteSuggestionsToDocument: CollectionAfterDeleteHook = async ({ collection, id, req }) => {
  const { payload } = req
  const { slug } = getRedirectsConfig(payload)
  // Read first, on the index of document targets, so a document without a suggestion costs this query
  // alone: a delete of nothing still clears the preferences of what it deleted.
  const { docs } = await payload.find({
    collection: slug,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: {},
    // By a field no index holds, as the notices ask, so SQLite with statistics searches the index.
    sort: TYPE_FIELD_NAME,
    where: {
      and: [
        { [TARGET_DOCUMENT_KEY_FIELD_NAME]: { equals: buildDocumentKey(collection.slug, id) } },
        { [STATUS_FIELD_NAME]: { equals: 'suggested' satisfies Status } }
      ]
    }
  })
  if (docs.length === 0) return
  // A delete through a where reports a suggestion it couldn't delete rather than throw, so a refusal
  // keeps that one and changes nothing else.
  await payload.delete({
    collection: slug,
    depth: 0,
    overrideAccess: true,
    req,
    where: { id: { in: docs.map(({ id: suggestionId }) => suggestionId) } }
  })
}
