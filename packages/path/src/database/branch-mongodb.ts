import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { CollectionSlug, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import type { Id } from '../path/build-path-and-ancestors.js'
import type { BranchMove } from '../path/move-branch.js'
import type { StartsBelow } from '../path/starts-below.js'
import { getParentFieldName, isLocalized } from '../plugin/options.js'
import { fieldKey } from '../utils/locales.js'

type Model = MongooseAdapter['collections'][string]

/**
 * The statements on MongoDB, for the documents below and then for their latest versions: an update
 * pipeline for the locales whose start changes, an update of the parent, and an update pipeline for
 * the ancestors. $literal holds every value of a pipeline, so none is read as a field. The filter of
 * the paths takes only a row whose path starts with an old start, because the pipeline gives a row
 * without a path an empty object of locales.
 */
export async function setPathAndAncestorsBelowInMongodb(
  { collection, id }: Pick<BranchMove, 'collection' | 'id'>,
  { ancestors, liftedTo, paths }: StartsBelow,
  req: PayloadRequest
) {
  const { payload } = req
  const localized = isLocalized(collection, payload)
  const parentField = getParentFieldName(collection, payload)
  // One update serves every locale, so a locale whose path doesn't start with the old start keeps it.
  const buildPathUpdate = (field: string) => {
    const pathReplacements = paths.map(({ from, locale, to }) => {
      const pathKey = fieldKey(field, locale, localized)
      const storedPath = `$${pathKey}`
      const oldStart = { $literal: `${from}/` }
      const hasOldStart = { $eq: [{ $substrCP: [storedPath, 0, { $strLenCP: oldStart }] }, oldStart] }
      const pathAfterOldStart = { $substrCP: [storedPath, { $strLenCP: { $literal: from } }, { $strLenCP: storedPath }] }
      const replacedPath = { $cond: [hasOldStart, { $concat: [{ $literal: to }, pathAfterOldStart] }, storedPath] }
      return { hasOldStart, pathKey, replacedPath }
    })
    return {
      filter: { $expr: { $or: pathReplacements.map(({ hasOldStart }) => hasOldStart) } },
      pipeline: [{ $set: Object.fromEntries(pathReplacements.map(({ pathKey, replacedPath }) => [pathKey, replacedPath])) }]
    }
  }
  const { collections, sessions, versions } = payload.db as unknown as MongooseAdapter
  // mongoose casts a filter and not a pipeline, so an id goes into one as the documents store it in
  // their ancestors: an ObjectId, or the number or text a collection of ids of its own has.
  const castIds = (ids: Id[]) => [
    ...(collections[collection]!.castObject({ ancestors: ids }) as { ancestors: unknown[] }).ancestors
  ]
  // $indexOfArray finds the first time the moved document comes, as buildReplacedPathAndAncestors does.
  const buildAncestorsUpdate = (ancestorsField: string, newAncestors: Id[]) => {
    const storedAncestors = `$${ancestorsField}`
    const [movedDocumentId] = castIds([id])
    const movedDocumentIndex = { $indexOfArray: [storedAncestors, { $literal: movedDocumentId }] }
    const ancestorsBelowMovedDocument = {
      $slice: [storedAncestors, { $add: [movedDocumentIndex, 1] }, { $size: storedAncestors }]
    }
    return [{ $set: { [ancestorsField]: { $concatArrays: [{ $literal: castIds(newAncestors) }, ancestorsBelowMovedDocument] } } }]
  }
  // mongoose takes a pipeline only with updatePipeline, and stamps a new updatedAt without timestamps: false.
  const updateOptions = { session: sessions[String(await req.transactionID)], timestamps: false, updatePipeline: true }
  // Writes the rows below that a filter finds in a model, at the fields under a prefix. The filter
  // finds a row by the moved document among its ancestors, which a lift takes out of them, so the
  // ancestors come last, after the paths and the parent of the rows right below. The parent is a plain
  // update, which mongoose casts.
  const setRowsBelow = async (model: Model, rowsBelowFilter: Record<string, unknown>, fieldPrefix: string) => {
    if (paths.length > 0) {
      const { filter, pipeline } = buildPathUpdate(`${fieldPrefix}path`)
      await model.updateMany({ ...rowsBelowFilter, ...filter }, pipeline, updateOptions)
    }
    if (liftedTo !== undefined && parentField !== undefined) {
      const parentKey = `${fieldPrefix}${parentField}`
      await model.updateMany({ ...rowsBelowFilter, [parentKey]: id }, { $set: { [parentKey]: liftedTo } }, updateOptions)
    }
    if (ancestors) {
      await model.updateMany(rowsBelowFilter, buildAncestorsUpdate(`${fieldPrefix}ancestors`, ancestors), updateOptions)
    }
  }
  await setRowsBelow(collections[collection]!, { ancestors: id }, '')
  if (!hasDraftsEnabled(payload.collections[collection as CollectionSlug].config)) return
  await setRowsBelow(versions[collection]!, { latest: true, 'version.ancestors': id }, 'version.')
}
