import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { PayloadRequest } from 'payload'

import type { RowFields, RowKind } from './branch.js'

/**
 * The write on MongoDB: one bulk write of an update per row, which the driver sends as one command.
 * mongoose casts each id and value as the model stores it, and stamps a new updatedAt without
 * timestamps: false.
 */
export async function setPathAndAncestorsFieldsInMongodb(
  collection: string,
  kind: RowKind,
  rows: RowFields[],
  req: PayloadRequest
) {
  const { collections, sessions, versions } = req.payload.db as unknown as MongooseAdapter
  const [model, fieldPrefix] = kind === 'documents' ? [collections[collection]!, ''] : [versions[collection]!, 'version.']
  const updates = rows.map(({ fields, id }) => ({
    updateOne: {
      filter: { _id: id },
      timestamps: false,
      update: { $set: Object.fromEntries(Object.entries(fields).map(([field, value]) => [`${fieldPrefix}${field}`, value])) }
    }
  }))
  await model.bulkWrite(updates, { session: sessions[String(await req.transactionID)] })
}
