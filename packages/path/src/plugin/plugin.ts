import type { CollectionConfig, Plugin } from 'payload'
import type { Slugify } from 'payload/shared'

import { ancestorsField } from '../fields/ancestors.js'
import { parentField } from '../fields/parent.js'
import { pathField } from '../fields/path.js'
import { slugField } from '../fields/slug.js'
import { liftBranchBeforeDelete, reportPathsAfterDelete } from '../hooks/delete.js'
import { placeAfterSave, planPathBeforeSave } from '../hooks/save.js'
import { missingCollectionsError, repeatedCollectionsError, takenFieldNamesError } from './messages.js'
import { hasPayloadHierarchy, resolvePathConfig, storePathConfig, type PathPluginOptions } from './options.js'

// A collection whose documents have a parent stores their ancestors, and gets the plugin's parent
// field unless Payload's own hierarchy brings one. The plugin's hooks go ahead of the collection's
// own, so those see the path and a refused save stops before them.
function withPath(
  collection: CollectionConfig,
  { hasParent, localized, slugify }: { hasParent: boolean; localized: boolean; slugify: Slugify }
): CollectionConfig {
  const fields = [
    ...(hasParent && !hasPayloadHierarchy(collection) ? [parentField(collection.slug)] : []),
    slugField({ localized, slugify, useAsTitle: collection.admin?.useAsTitle }),
    pathField(localized),
    ...(hasParent ? [ancestorsField(collection.slug)] : [])
  ]
  // A collection can't have a field of its own under the name of one the plugin adds to it.
  const fieldNames = fields.map(({ name }) => name)
  const takenFieldNames = collection.fields.flatMap((field) =>
    'name' in field && fieldNames.includes(field.name) ? [field.name] : []
  )
  if (takenFieldNames.length > 0) throw new Error(takenFieldNamesError(takenFieldNames, collection.slug))
  return {
    ...collection,
    fields: [...collection.fields, ...fields],
    hooks: {
      ...collection.hooks,
      afterChange: [placeAfterSave, ...(collection.hooks?.afterChange ?? [])],
      afterDelete: [reportPathsAfterDelete, ...(collection.hooks?.afterDelete ?? [])],
      beforeChange: [planPathBeforeSave, ...(collection.hooks?.beforeChange ?? [])],
      beforeDelete: [liftBranchBeforeDelete, ...(collection.hooks?.beforeDelete ?? [])]
    }
  }
}

/**
 * Gives the documents of the collections it is given a stored path: the parent's path, a slash and
 * the slug, below the collection's base path. Each collection's documents sit below its own, by the
 * plugin's parent field or by the one of Payload's own hierarchy, or below none.
 */
export function pathPlugin(options: PathPluginOptions): Plugin {
  return (config) => {
    const pathConfig = resolvePathConfig(options, config)
    const slugs = pathConfig.collections.map(({ slug }) => slug)
    const repeatedSlugs = [...new Set(slugs.filter((slug, index) => slugs.indexOf(slug) !== index))]
    if (repeatedSlugs.length > 0) throw new Error(repeatedCollectionsError(repeatedSlugs))
    const missingSlugs = slugs.filter((slug) => !config.collections?.some((collection) => collection.slug === slug))
    if (missingSlugs.length > 0) throw new Error(missingCollectionsError(missingSlugs))
    return {
      ...config,
      collections: config.collections?.map((collection) => {
        const given = pathConfig.collections.find(({ slug }) => slug === collection.slug)
        return given ? withPath(collection, { ...given, slugify: pathConfig.slugify }) : collection
      }),
      custom: storePathConfig(config.custom, pathConfig)
    }
  }
}
