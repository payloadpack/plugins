import type { FieldHook, TextField } from 'payload'

import { TO_FIELD_NAME, type StoredTarget } from './to.js'

export const TARGET_DOCUMENT_KEY_FIELD_NAME = 'targetDocumentKey'

/**
 * A document of any collection as one value, its collection and its id, such as ["pages","12"]: the
 * same for an id given as a number, a string or a MongoDB ObjectId.
 */
export const buildDocumentKey = (collection: string, id: unknown) => JSON.stringify([collection, String(id)])

// Set on every save, from the stored fields with the sent ones over them, which Payload has merged
// before any change hook runs, so a save that sends only some fields keeps it.
const setTargetDocumentKey: FieldHook = ({ siblingData }) => {
  const { document, type } = (siblingData[TO_FIELD_NAME] ?? {}) as StoredTarget
  if (type !== 'document' || !document?.relationTo || document.value === null || document.value === undefined) return null
  return buildDocumentKey(document.relationTo, document.value)
}

/**
 * The document key of a redirect's document target, indexed, by which a document's edit view and its
 * delete find the suggestions to it on the redirects' own row. Null for a URL target. Indexed alone:
 * with the status beside it, Postgres without statistics reads that index for a lookup's status.
 */
export const buildTargetDocumentKeyField = (): TextField => ({
  name: TARGET_DOCUMENT_KEY_FIELD_NAME,
  type: 'text',
  admin: { hidden: true },
  hooks: { beforeChange: [setTargetDocumentKey] },
  index: true
})
