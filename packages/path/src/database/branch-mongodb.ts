import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import type { StartsBelow } from '../path/starts-below.js'
import { fieldKey } from '../utils/locales.js'

/**
 * The statements on MongoDB, for the documents below or for their latest versions: an update
 * pipeline for the locales whose start changes, an update of the parent, and an update pipeline for
 * the ancestors. $literal holds every value of a pipeline, so none is read as a field. The filter of
 * the paths takes only a row whose path starts with an old start, because the pipeline gives a row
 * without a path an empty object of locales.
 */
export async function buildStatementsBelowInMongodb(collection: string, id: Id, localized: boolean, req: PayloadRequest) {
  // One update serves every locale, so a locale whose path doesn't start with the old start keeps it.
  const buildPathUpdate = (field: string, paths: StartsBelow['paths']) => {
    const pathReplacements = paths.map(({ locale, newStart, oldStart }) => {
      const pathKey = fieldKey(field, locale, localized)
      const storedPath = `$${pathKey}`
      const oldStartAndSlash = { $literal: `${oldStart}/` }
      const hasOldStart = { $eq: [{ $substrCP: [storedPath, 0, { $strLenCP: oldStartAndSlash }] }, oldStartAndSlash] }
      const pathAfterOldStart = { $substrCP: [storedPath, { $strLenCP: { $literal: oldStart } }, { $strLenCP: storedPath }] }
      const replacedPath = { $cond: [hasOldStart, { $concat: [{ $literal: newStart }, pathAfterOldStart] }, storedPath] }
      return { hasOldStart, pathKey, replacedPath }
    })
    return {
      filter: { $expr: { $or: pathReplacements.map(({ hasOldStart }) => hasOldStart) } },
      pipeline: [{ $set: Object.fromEntries(pathReplacements.map(({ pathKey, replacedPath }) => [pathKey, replacedPath])) }]
    }
  }
  const { collections, sessions, versions } = req.payload.db as unknown as MongooseAdapter
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
  return (rowKind: 'documents' | 'versions') => {
    // The model of the documents or of their versions, the key a field the statements write has there,
    // and the filter that finds the rows below there: the ones that hold the moved document among their
    // ancestors, and of the versions the latest only.
    const isDocuments = rowKind === 'documents'
    const model = isDocuments ? collections[collection]! : versions[collection]!
    const getRowFieldKey = (field: string) => (isDocuments ? field : `version.${field}`)
    const rowsBelowFilter = isDocuments ? { ancestors: id } : { latest: true, 'version.ancestors': id }
    return {
      setAncestors: async (ancestors: Id[]) => {
        await model.updateMany(rowsBelowFilter, buildAncestorsUpdate(getRowFieldKey('ancestors'), ancestors), updateOptions)
      },
      // The parent is a plain update, which mongoose casts.
      setLiftedParent: async (parentField: string, liftParentId: Id | null) => {
        const parentKey = getRowFieldKey(parentField)
        await model.updateMany({ ...rowsBelowFilter, [parentKey]: id }, { $set: { [parentKey]: liftParentId } }, updateOptions)
      },
      setPathStarts: async (paths: StartsBelow['paths']) => {
        const { filter, pipeline } = buildPathUpdate(getRowFieldKey('path'), paths)
        await model.updateMany({ ...rowsBelowFilter, ...filter }, pipeline, updateOptions)
      }
    }
  }
}
