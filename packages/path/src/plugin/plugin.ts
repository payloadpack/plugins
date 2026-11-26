import type { CollectionConfig, Plugin } from 'payload'
import type { Slugify } from 'payload/shared'

import { ancestorsField } from '../fields/ancestors.js'
import { parentField } from '../fields/parent.js'
import { pathField } from '../fields/path.js'
import { fillPathRelationshipFields, listPathRelationshipFields } from '../fields/path-relationship.js'
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
  pathRelationshipFieldsWithoutCollectionsError,
  repeatedCollectionsError,
  takenFieldNamesError
} from './messages.js'
import {
  buildTypescriptSchema,
  getCollection,
  getFieldOptions,
  getPathCollections,
  hasPayloadHierarchy,
  resolvePathConfig,
  storePathConfig,
  type FieldOptions,
  type PathPluginOptions
} from './options.js'

function buildCollectionWithPath(
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
  const fieldNames = new Set(fields.map(({ name }) => name))
  const takenFieldNames = collection.fields.flatMap((field) =>
    'name' in field && fieldNames.has(field.name) ? [field.name] : []
  )
  if (takenFieldNames.length > 0) throw new Error(takenFieldNamesError(takenFieldNames, collection.slug))
  return {
    ...collection,
    fields: [...collection.fields, ...fields],
    // The plugin's hooks go ahead of the collection's own, so those see the path and a refused save or
    // delete stops before them. Two go after them: the lift of a delete, so a delete the collection's
    // own hooks refuse moves nothing, and startBulkOperationBeforeOperation, which then sees the
    // operation as it runs.
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
 * Gives the documents of the collections it is given, in collections or with withPath, a stored path:
 * the parent's path, a slash and the slug, below the collection's base path. Each collection's
 * documents sit below its own, by the plugin's parent field or by the one of Payload's own hierarchy,
 * or below none. Every field made with pathRelationshipField, wherever it sits in the config,
 * picks from these collections, or from the ones among them that it names.
 */
export function pathPlugin(options: PathPluginOptions = {}): Plugin {
  return (config) => {
    const pathCollections = getPathCollections(options, config)
    const pathRelationshipFields = listPathRelationshipFields(config)
    if (pathCollections.length === 0) {
      if (pathRelationshipFields.length === 0) return config
      const fieldNames = [...new Set(pathRelationshipFields.map(({ name }) => name))]
      throw new Error(pathRelationshipFieldsWithoutCollectionsError(fieldNames))
    }
    const pathConfig = resolvePathConfig(options, pathCollections, config)
    const slugs = pathConfig.collections.map(({ slug }) => slug)
    const repeatedSlugs = [...new Set(slugs.filter((slug, index) => slugs.indexOf(slug) !== index))]
    if (repeatedSlugs.length > 0) throw new Error(repeatedCollectionsError(repeatedSlugs))
    const missingSlugs = slugs.filter((slug) => !config.collections?.some((collection) => collection.slug === slug))
    if (missingSlugs.length > 0) throw new Error(missingCollectionsError(missingSlugs))
    // In place, because such a field sits at any depth of a collection, a global or a block, where a
    // copy of everything around it would gain nothing: Payload builds on the same field objects.
    fillPathRelationshipFields(pathRelationshipFields, slugs)
    return {
      ...config,
      collections: config.collections?.map((collection) => {
        const pathCollection = getCollection(collection.slug, pathConfig)
        if (!pathCollection) return collection
        const fieldOptions = getFieldOptions(collection.slug, pathCollections)
        return buildCollectionWithPath(collection, { ...pathCollection, fieldOptions, slugify: pathConfig.slugify })
      }),
      custom: storePathConfig(config.custom, pathConfig),
      typescript: { ...config.typescript, schema: [...(config.typescript?.schema ?? []), buildTypescriptSchema(slugs)] }
    }
  }
}
