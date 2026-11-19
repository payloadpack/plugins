import type { CollectionConfig, Plugin } from 'payload'
import type { Slugify } from 'payload/shared'

import { ancestorsField } from '../fields/ancestors.js'
import { parentField } from '../fields/parent.js'
import { pathField } from '../fields/path.js'
import { slugField } from '../fields/slug.js'
import { setPathAfterChange } from '../hooks/after-change.js'
import { reportPathsAfterDelete } from '../hooks/after-delete.js'
import { endBulkOperationAfterOperation } from '../hooks/after-operation.js'
import { checkPathBeforeChange } from '../hooks/before-change.js'
import { checkLiftBeforeDelete, liftBranchBeforeDelete } from '../hooks/before-delete.js'
import { startBulkOperationBeforeOperation } from '../hooks/before-operation.js'
import {
  missingCollectionsError,
  parentFieldWithoutParentError,
  repeatedCollectionsError,
  takenFieldNamesError
} from './messages.js'
import {
  getCollection,
  getFieldOptions,
  hasPayloadHierarchy,
  resolvePathConfig,
  storePathConfig,
  type FieldOptions,
  type PathPluginOptions
} from './options.js'

// A collection whose documents have a parent stores their ancestors, and gets the plugin's parent
// field unless Payload's own hierarchy brings one. Only that field takes what the site sets on a
// parent field. The plugin's hooks go ahead of the collection's own, so those see the path and a
// refused save or delete stops before them. Two go after them: the lift of a delete, so a delete the
// collection's own hooks refuse moves nothing, and the start of a bulk operation, which then sees the
// operation as it runs.
function withPath(
  collection: CollectionConfig,
  {
    fieldOptions,
    hasParent,
    localized,
    slugify
  }: { fieldOptions: FieldOptions; hasParent: boolean; localized: boolean; slugify: Slugify }
): CollectionConfig {
  const hasOwnParent = hasParent && !hasPayloadHierarchy(collection)
  if (fieldOptions.parentField && !hasOwnParent) throw new Error(parentFieldWithoutParentError(collection.slug))
  const fields = [
    ...(hasOwnParent ? [parentField(collection.slug, fieldOptions.parentField)] : []),
    slugField({ localized, slugify, useAsTitle: collection.admin?.useAsTitle }, fieldOptions.slugField),
    pathField(localized),
    ...(hasParent ? [ancestorsField(collection.slug)] : [])
  ]
  // A collection can't have a field of its own under the name of one the plugin adds to it.
  const fieldNames = new Set(fields.map(({ name }) => name))
  const takenFieldNames = collection.fields.flatMap((field) =>
    'name' in field && fieldNames.has(field.name) ? [field.name] : []
  )
  if (takenFieldNames.length > 0) throw new Error(takenFieldNamesError(takenFieldNames, collection.slug))
  return {
    ...collection,
    fields: [...collection.fields, ...fields],
    hooks: {
      ...collection.hooks,
      afterChange: [setPathAfterChange, ...(collection.hooks?.afterChange ?? [])],
      afterDelete: [reportPathsAfterDelete, ...(collection.hooks?.afterDelete ?? [])],
      afterOperation: [endBulkOperationAfterOperation, ...(collection.hooks?.afterOperation ?? [])],
      beforeChange: [checkPathBeforeChange, ...(collection.hooks?.beforeChange ?? [])],
      beforeDelete: [checkLiftBeforeDelete, ...(collection.hooks?.beforeDelete ?? []), liftBranchBeforeDelete],
      beforeOperation: [...(collection.hooks?.beforeOperation ?? []), startBulkOperationBeforeOperation]
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
        const given = getCollection(collection.slug, pathConfig)
        if (!given) return collection
        const fieldOptions = getFieldOptions(collection.slug, options)
        return withPath(collection, { ...given, fieldOptions, slugify: pathConfig.slugify })
      }),
      custom: storePathConfig(config.custom, pathConfig)
    }
  }
}
