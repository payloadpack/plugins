import {
  createPayloadRequest,
  ValidationError,
  type CollectionConfig,
  type CollectionSlug,
  type Payload,
  type PayloadRequest
} from 'payload'

import { findDocuments, findParentPathAndAncestors, setPathAndAncestors } from '../database/documents.js'
import { findLatestVersionByDocument, setDraftPathAndAncestors, type DocumentAndLatestVersion } from '../database/versions.js'
import {
  buildPathAndAncestors,
  getSlugsAndParent,
  getStoredPathAndAncestors,
  hasSamePathAndAncestors,
  type Id
} from '../path/build-path-and-ancestors.js'
import { buildFieldError, MISSING_SLUG_REFUSAL, REFUSAL_FIELD } from '../plugin/messages.js'
import { getPathConfig, pickCollections } from '../plugin/options.js'
import { hasDrafts } from '../utils/published-locales.js'
import { checkNewPaths, getNewPaths } from '../validation/check-new-paths.js'
import { checkParent } from '../validation/check-parent.js'

/** What a backfill did to the documents it went through. */
export type BackfillReport = {
  /** The documents left as they were, each with the refusal a save of it would get. */
  left: { collection: string; id: Id; refusal: string }[]
  /**
   * How many documents got another path or other ancestors than they stored, in the document or its
   * latest version.
   */
  updated: number
  /** How many documents stored their path and ancestors already. */
  unchanged: number
}

// A stored document's path and ancestors, or the ones its latest draft would give it, below a parent
// it can sit below, as that parent is stored. A document without a slug in any locale has none to
// make a path from.
async function findParentAndBuildCheckedPathAndAncestors(
  stored: DocumentAndLatestVersion,
  kind: 'document' | 'draft',
  collection: CollectionConfig,
  req: PayloadRequest
) {
  const slugsAndParent = getSlugsAndParent(stored, kind, collection, req.payload)
  if (Object.values(slugsAndParent.slugs).every((slug) => typeof slug !== 'string' || slug === '')) {
    throw buildFieldError(collection.slug, REFUSAL_FIELD, MISSING_SLUG_REFUSAL, req)
  }
  const parent = await findParentPathAndAncestors(collection.slug, slugsAndParent.parentId, req)
  checkParent(collection.slug, { id: stored.document.id, parent, parentId: slugsAndParent.parentId }, req)
  return buildPathAndAncestors(slugsAndParent, parent, collection, req.payload)
}

// Stores a document's path and ancestors, and the ones its latest draft would give it, where its rows
// store other ones, as a move stores them, and says whether it stored any. Refused as a save is,
// before either write.
async function backfillDocument(stored: DocumentAndLatestVersion, collection: CollectionConfig, req: PayloadRequest) {
  const { document, version } = stored
  const built = await findParentAndBuildCheckedPathAndAncestors(stored, 'document', collection, req)
  const builtDraft = version ? await findParentAndBuildCheckedPathAndAncestors(stored, 'draft', collection, req) : built
  const storedInDocument = getStoredPathAndAncestors(document, collection.slug, req.payload)
  const storedInVersion = version && getStoredPathAndAncestors(version.version, collection.slug, req.payload)
  const newPaths = [...getNewPaths(built, storedInDocument), ...(storedInVersion ? getNewPaths(builtDraft, storedInVersion) : [])]
  await checkNewPaths(collection, document.id, newPaths, req)
  const setsDocument = !hasSamePathAndAncestors(built, storedInDocument)
  const setsDraft =
    version !== undefined && storedInVersion !== undefined && !hasSamePathAndAncestors(builtDraft, storedInVersion)
  if (setsDocument) await setPathAndAncestors(collection.slug, document, built, req)
  if (setsDraft) await setDraftPathAndAncestors(collection.slug, version, builtDraft, req)
  return setsDocument || setsDraft
}

// A collection's documents as the database holds them, parents before the documents below them.
async function findStoredTopDown(collection: CollectionConfig, req: PayloadRequest) {
  const documents = await findDocuments(collection.slug, {}, req)
  const versions = hasDrafts(collection) ? await findLatestVersionByDocument(collection.slug, {}, req) : undefined
  const stored = documents.map((document): DocumentAndLatestVersion => ({
    document,
    version: versions?.get(String(document.id))
  }))
  const parents = new Map(
    stored.map((each) => [String(each.document.id), getSlugsAndParent(each, 'document', collection, req.payload).parentId])
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
 * Gives every document of the plugin's collections, or of the ones named, the path and ancestors its
 * slugs and its parent make by the one rule, for a site that had documents before it added the plugin
 * and for a move that stopped halfway. Parents come before the documents below them, and only a row
 * that stores another path or other ancestors is written, as a move writes it: without a new version
 * and without the collection's hooks. A document a save would refuse, and one without a slug in any
 * locale, is left as it is and listed with the refusal.
 */
export async function backfillPaths({
  collections,
  payload
}: {
  /** The collections to go through, among the plugin's. Without it, every one of them. */
  collections?: CollectionSlug[]
  payload: Payload
}): Promise<BackfillReport> {
  const slugs = pickCollections(collections, getPathConfig(payload))
  // In every locale at once, so a refusal names the locale of the path it is about.
  const req = await createPayloadRequest({ locale: 'all', payload })
  const report: BackfillReport = { left: [], updated: 0, unchanged: 0 }
  for (const slug of slugs) {
    const collection = payload.collections[slug].config
    for (const stored of await findStoredTopDown(collection, req)) {
      try {
        if (await backfillDocument(stored, collection, req)) report.updated++
        else report.unchanged++
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error
        report.left.push({ collection: slug, id: stored.document.id, refusal: error.data.errors[0]!.message })
      }
    }
  }
  return report
}
