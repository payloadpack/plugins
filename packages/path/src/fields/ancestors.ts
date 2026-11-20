import type { CollectionSlug, RelationshipField } from 'payload'

export function ancestorsField(collectionSlug: CollectionSlug): RelationshipField {
  return {
    name: 'ancestors',
    type: 'relationship',
    // The admin panel leaves the field out, and the API still returns and filters by it.
    admin: { disabled: true },
    hasMany: true,
    // So a move finds its whole branch at once. MongoDB needs it, and the relationships table of
    // Postgres and SQLite has one anyway.
    index: true,
    maxDepth: 0,
    relationTo: collectionSlug
  }
}
