import { APIError, type CollectionBeforeDeleteHook } from 'payload'

import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { TO_FIELD_NAME, type TargetType } from '../fields/to.js'
import { getRedirectsConfig } from './options.js'

/**
 * Deletes the suggestions to a document as it is deleted: once it is gone they send nobody, and Yes
 * would turn on a redirect to nothing. Before the delete, since Postgres and SQLite drop the row that
 * holds the target with the document, and through the delete's req, so a delete that fails keeps them.
 * An editor's redirect to the document, On or Off, stays and sends nobody, and a document moved to the
 * trash keeps its suggestions until it is deleted from there.
 */
export const deleteSuggestionsToDocument: CollectionBeforeDeleteHook = async ({ collection, id, req }) => {
  const { payload } = req
  const { slug } = getRedirectsConfig(payload)
  // Read first, on the index of suggestions, so a document without one costs this query alone: a
  // delete of nothing still clears the preferences of what it deleted.
  const { docs } = await payload.find({
    collection: slug,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: {},
    where: {
      and: [
        { [STATUS_FIELD_NAME]: { equals: 'suggested' satisfies Status } },
        { [`${TO_FIELD_NAME}.type`]: { equals: 'document' satisfies TargetType } },
        { [`${TO_FIELD_NAME}.document.relationTo`]: { equals: collection.slug } },
        { [`${TO_FIELD_NAME}.document.value`]: { equals: id } }
      ]
    }
  })
  if (docs.length === 0) return
  const { errors } = await payload.delete({
    collection: slug,
    depth: 0,
    overrideAccess: true,
    req,
    where: { id: { in: docs.map(({ id: suggestionId }) => suggestionId) } }
  })
  // A bulk delete reports what it couldn't delete instead of throwing, and the document can't go as if
  // its suggestions were gone.
  if (errors[0]) throw new APIError(errors[0].message, 400, null, errors[0].isPublic)
}
