import {
  createPayloadRequest,
  ValidationError,
  type CollectionConfig,
  type CollectionSlug,
  type Payload,
  type PayloadRequest
} from 'payload'

import { buildFieldError, MISSING_SLUG_REFUSAL, REFUSAL_FIELD } from '../plugin/messages.js'
import { getPathConfig, pickCollections } from '../plugin/options.js'
import { checkNewPaths, checkParent, findNewPaths } from './checks.js'
import { isSamePlace, readRecord, readStoredPlace, workOutPlace, type Id, type Stored } from './place.js'
import { hasDrafts } from './status.js'
import { findDocuments, findLatestVersionByDocument, readParentPlace, writePlace, writePlan } from './stored.js'

export type BackfillReport = {
  // The documents left as they were, each with the refusal a save of it would get.
  left: { collection: string; id: Id; refusal: string }[]
  // How many documents got another place than they stored, in the document or its latest version.
  placed: number
  // How many documents stored their place already.
  unchanged: number
}

// A stored document's place, or its plan, below a parent it can sit below, as that parent is stored.
// A document without a slug in any locale has none to be placed by.
async function workOutCheckedPlace(stored: Stored, kind: 'place' | 'plan', collection: CollectionConfig, req: PayloadRequest) {
  const record = readRecord(stored, kind, collection, req.payload)
  if (Object.values(record.slugs).every((slug) => typeof slug !== 'string' || slug === '')) {
    throw buildFieldError(collection.slug, REFUSAL_FIELD, MISSING_SLUG_REFUSAL, req)
  }
  const parent = await readParentPlace(collection.slug, record.parentId, req)
  checkParent(collection.slug, { id: stored.document.id, parent, parentId: record.parentId }, req)
  return workOutPlace(record, parent, collection, req.payload)
}

// Writes a stored document's place and plan where its rows store other ones, as a move writes them,
// and says whether it wrote. Refused as a save is, before either write.
async function placeStored(stored: Stored, collection: CollectionConfig, req: PayloadRequest) {
  const { document, version } = stored
  const place = await workOutCheckedPlace(stored, 'place', collection, req)
  const plan = version ? await workOutCheckedPlace(stored, 'plan', collection, req) : place
  const storedPlace = readStoredPlace(document, collection.slug, req.payload)
  const storedPlan = version && readStoredPlace(version.version, collection.slug, req.payload)
  const newPaths = [...findNewPaths(place, storedPlace), ...(storedPlan ? findNewPaths(plan, storedPlan) : [])]
  await checkNewPaths(collection, document.id, newPaths, req)
  const writesPlace = !isSamePlace(place, storedPlace)
  const writesPlan = version !== undefined && storedPlan !== undefined && !isSamePlace(plan, storedPlan)
  if (writesPlace) await writePlace(collection.slug, document, place, req)
  if (writesPlan) await writePlan(collection.slug, version, plan, req)
  return writesPlace || writesPlan
}

// A collection's documents as the database holds them, parents before the documents below them.
async function findStoredTopDown(collection: CollectionConfig, req: PayloadRequest) {
  const documents = await findDocuments(collection.slug, {}, req)
  const versions = hasDrafts(collection) ? await findLatestVersionByDocument(collection.slug, {}, req) : undefined
  const stored = documents.map((document): Stored => ({ document, version: versions?.get(String(document.id)) }))
  const parents = new Map(
    stored.map((each) => [String(each.document.id), readRecord(each, 'place', collection, req.payload).parentId])
  )
  // How many documents sit above a document. Stored parents that form a ring end at the count of all.
  const depths = new Map(
    stored.map(({ document }) => {
      let depth = 0
      for (let above = parents.get(String(document.id)); above != null && depth < stored.length; depth++) {
        above = parents.get(String(above))
      }
      return [document.id, depth]
    })
  )
  return stored.sort((each, other) => depths.get(each.document.id)! - depths.get(other.document.id)!)
}

/**
 * Gives every document of the plugin's collections, or of the ones named, the place its slugs and
 * its parent make by the one rule, for a site that had documents before it added the plugin and for
 * a move that stopped halfway. Parents come before the documents below them, and only a row that
 * stores another place is written, as a move writes it: without a new version and without the
 * collection's hooks. A document a save would refuse, and one without a slug in any locale, is left
 * as it is and listed with the refusal.
 */
export async function backfillPaths({
  collections,
  payload
}: {
  collections?: CollectionSlug[]
  payload: Payload
}): Promise<BackfillReport> {
  const slugs = pickCollections(collections, getPathConfig(payload))
  // In every locale at once, so a refusal names the locale of the path it is about.
  const req = await createPayloadRequest({ locale: 'all', payload })
  const report: BackfillReport = { left: [], placed: 0, unchanged: 0 }
  for (const slug of slugs) {
    const collection = payload.collections[slug].config
    for (const stored of await findStoredTopDown(collection, req)) {
      try {
        if (await placeStored(stored, collection, req)) report.placed++
        else report.unchanged++
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error
        report.left.push({ collection: slug, id: stored.document.id, refusal: error.data.errors[0]!.message })
      }
    }
  }
  return report
}
