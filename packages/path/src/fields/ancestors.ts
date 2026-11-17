import type { CollectionSlug, RelationshipField } from 'payload'

// The ids of the documents above a document, top-down, so a move finds its whole branch at once: by
// the index on them, which MongoDB needs and the relationships table of Postgres and SQLite has
// anyway. The admin panel leaves the field out, and the API returns and filters by it.
export function ancestorsField(collectionSlug: CollectionSlug): RelationshipField {
  return {
    name: 'ancestors',
    type: 'relationship',
    admin: { disabled: true },
    hasMany: true,
    index: true,
    maxDepth: 0,
    relationTo: collectionSlug
  }
}
