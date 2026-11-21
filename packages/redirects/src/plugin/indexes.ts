import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { Config } from 'payload'

import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { TO_FIELD_NAME } from '../fields/to.js'
import { ORDER_FIELD_NAME } from './redirects-collection.js'

// The sort Payload's orderable finds the last redirect with: _order, then the createdAt the MongoDB
// adapter adds to every sort on a field that isn't unique.
const ORDER_INDEX = { [ORDER_FIELD_NAME]: 1, createdAt: 1 } as const

// The suggestions to one document, which its edit view asks for on every load and save. It holds only
// suggestions, so it stays small, and a lookup, which reads only redirects that are on, never uses it.
const SUGGESTION_INDEX = { [`${TO_FIELD_NAME}.document.value`]: 1 } as const

const SUGGESTION_INDEX_OPTIONS = { partialFilterExpression: { [STATUS_FIELD_NAME]: 'suggested' satisfies Status } }

/**
 * The database adapter given, which on MongoDB adds two indexes to the redirects collection that the
 * collection can't declare: one on _order and createdAt, so a save of a new redirect reads one redirect
 * to put it last rather than every one, and one on the target of a suggestion, so an edit view finds
 * its document's suggestions without reading every redirect. On Postgres and SQLite a document target
 * sits in the redirects' relationships table, whose column for each collection Payload indexes itself.
 *
 * Payload checks a collection's indexes before orderable adds _order, and has no way to declare an
 * index on part of a relationship, or one that holds only some documents. The indexes go on the
 * model's schema once the adapter has built its models and before it connects, so mongoose builds them
 * on connect as it builds every index Payload declares: with autoIndex, which Payload leaves on but for
 * a hot reload, and with the adapter's ensureIndexes.
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
        schema?.index(SUGGESTION_INDEX, SUGGESTION_INDEX_OPTIONS)
      }
      return adapter
    }
  }
}
