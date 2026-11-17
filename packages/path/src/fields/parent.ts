import type { CollectionSlug, RelationshipField } from 'payload'

import { HOME_PAGE_PATH } from '../paths/place.js'
import { PARENT_FIELD_NAME } from '../plugin/options.js'

// A document sits below a document of its own collection, so each collection is a tree of its own.
// The picker leaves out the document itself and the home page, which holds no documents. A save
// refuses those, and the documents below the document itself, whatever the picker offered.
export function parentField(collectionSlug: CollectionSlug): RelationshipField {
  return {
    name: PARENT_FIELD_NAME,
    type: 'relationship',
    admin: { position: 'sidebar' },
    filterOptions: ({ id }) => ({
      ...(id === undefined ? {} : { id: { not_equals: id } }),
      path: { not_equals: HOME_PAGE_PATH }
    }),
    index: true,
    relationTo: collectionSlug
  }
}
