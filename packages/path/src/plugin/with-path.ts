import type { CollectionConfig } from 'payload'

import { WITH_PATH_KEY, type PathCollectionOptions } from './options.js'

/**
 * Gives the documents of a collection a path from the collection's own config, as the plugin's
 * collections does. It keeps the options in the collection's custom, which Payload keeps on the
 * server, and pathPlugin() adds the fields and hooks when it runs.
 */
export function withPath(collection: CollectionConfig, options: PathCollectionOptions = {}): CollectionConfig {
  return { ...collection, custom: { ...collection.custom, [WITH_PATH_KEY]: options } }
}
