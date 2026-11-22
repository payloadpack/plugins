import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { Config } from 'payload'

import { ORDER_FIELD_NAME } from './redirects-collection.js'

// The sort Payload's orderable finds the last redirect with: _order, then the createdAt the MongoDB
// adapter adds to every sort on a field that isn't unique.
const ORDER_INDEX = { [ORDER_FIELD_NAME]: 1, createdAt: 1 } as const

/**
 * The database adapter given, which on MongoDB adds the index on _order and createdAt to the redirects
 * collection, so a save of a new redirect reads one redirect to put it last rather than every one.
 *
 * Payload checks a collection's indexes before orderable adds _order, so the collection can't declare
 * it. The index goes on the model's schema once the adapter has built its models and before it
 * connects, so mongoose builds it on connect as it builds every index Payload declares: with
 * autoIndex, which Payload leaves on but for a hot reload, and with the adapter's ensureIndexes.
 */
export function addIndexes(db: Config['db'], slug: string): Config['db'] {
  return {
    ...db,
    init: (args) => {
      const adapter = db.init(args)
      if (adapter.name !== 'mongoose') return adapter
      const buildModels = adapter.init
      adapter.init = async () => {
        await buildModels?.call(adapter)
        const schema = (adapter as MongooseAdapter).collections[slug]?.schema
        schema?.index(ORDER_INDEX)
      }
      return adapter
    }
  }
}
