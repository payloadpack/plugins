import type { CollectionSlug, Plugin } from 'payload'

import { deleteSuggestionsToDocument } from './delete-suggestions-hook.js'
import { addIndexes } from './indexes.js'
import { withRedirectsConfig, buildRedirectsConfig, type RedirectsPluginOptions } from './options.js'
import { buildRedirectsCollection } from './redirects-collection.js'
import { buildSuggestionNoticesField } from './suggestion-notices-field.js'

/**
 * Adds the redirects collection: redirects editors manage, from a path, from a path and every path
 * below it, or from a regex, to a document of the collections given or a URL. Each of those
 * collections shows, above its fields, the redirects a move of the document suggests, for an editor to
 * say yes or no to. With winOverDocuments, redirects win over a document at a path they cover, the
 * ones an editor picks or every one.
 */
export function redirectsPlugin(options: RedirectsPluginOptions): Plugin {
  return (config) => {
    const redirectsConfig = buildRedirectsConfig(options)
    const defaultCollection = buildRedirectsCollection(redirectsConfig)
    const redirectsCollection = options.overrides ? options.overrides(defaultCollection) : defaultCollection
    const slug = redirectsCollection.slug as CollectionSlug
    const targetCollections = new Set<string>(redirectsConfig.collections)
    // Each of them shows its suggestions above its fields, and takes them with it when it is deleted,
    // after the site's own hooks.
    const collections = (config.collections ?? []).map((siteCollection) =>
      targetCollections.has(siteCollection.slug)
        ? {
            ...siteCollection,
            fields: [buildSuggestionNoticesField(slug), ...siteCollection.fields],
            hooks: {
              ...siteCollection.hooks,
              afterDelete: [...(siteCollection.hooks?.afterDelete ?? []), deleteSuggestionsToDocument]
            }
          }
        : siteCollection
    )
    return {
      ...config,
      collections: [...collections, redirectsCollection],
      custom: withRedirectsConfig(config.custom, { ...redirectsConfig, slug }),
      db: addIndexes(config.db, slug)
    }
  }
}
