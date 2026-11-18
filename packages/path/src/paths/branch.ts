import type { CollectionConfig, PayloadRequest } from 'payload'

import { becomesHomePageRefusal, buildFieldError, describeTakenPath, REFUSAL_FIELD } from '../plugin/messages.js'
import { findReservedPathRefusal, getParentFieldName } from '../plugin/options.js'
import {
  HOME_PAGE_PATH,
  isSamePlace,
  readPaths,
  readRecord,
  readStoredPlace,
  workOutPlace,
  type Id,
  type ParentPlace,
  type Place,
  type StoredDocument,
  type StoredVersion
} from './place.js'
import { hasDrafts } from './status.js'
import { findDocumentsBelow, findLatestVersionsBelow, writePlace, writePlan } from './stored.js'
import { findTakenPath } from './taken-paths.js'

type BranchMoveRequest = {
  collection: CollectionConfig
  // The document whose branch moves, or the deleted document whose branch is lifted.
  document: StoredDocument
  // What the documents right below hang from now: the document at its new place, for a lift its
  // parent, or nothing at the top level.
  parent: ParentPlace | null
  req: PayloadRequest
}

// The rows of a branch that get another place or plan than they store, top-down, and how many
// documents the branch holds below its first.
export type BranchMove = {
  collection: string
  documents: { document: StoredDocument; place: Place }[]
  documentsBelow: number
  versions: { plan: Place; version: StoredVersion }[]
}

// How many documents sit below a document, which is none in a collection without parents, where
// there are no ancestors to ask for.
export async function countBelow(collection: string, id: Id, req: PayloadRequest) {
  if (getParentFieldName(collection, req.payload) === undefined) return 0
  return (await req.payload.db.count({ collection, req, where: { ancestors: { equals: id } } })).totalDocs
}

/**
 * Works out where every document below a document is once that document has moved, or is deleted,
 * and what each latest version below it plans: top-down, each from its own slugs and the new place of
 * its parent, by the one rule. It checks the whole branch and writes nothing: a branch carries none
 * of its documents onto a path that is reserved or taken.
 */
export async function planBranchMove({ collection, document: moved, parent, req }: BranchMoveRequest): Promise<BranchMove> {
  const { payload } = req
  const { slug } = collection
  // In a collection without parents nothing sits below a document, so there is no branch to read.
  if (getParentFieldName(slug, payload) === undefined) return { collection: slug, documents: [], documentsBelow: 0, versions: [] }
  const documentCount = await countBelow(slug, moved.id, req)
  const below = documentCount > 0 ? await findDocumentsBelow(slug, moved.id, req) : []
  // The latest versions of those documents, and the ones that plan a place below the document while
  // their own document is elsewhere.
  const versions = hasDrafts(collection)
    ? await findLatestVersionsBelow(
        slug,
        moved.id,
        below.map(({ id }) => id),
        req
      )
    : new Map<string, StoredVersion>()
  // What each document that others hang from gives them now, by its id: the document itself its new
  // place, and a deleted document the place it hung from, so a lift needs no rule of its own. A row
  // that hangs from a document outside the branch stays as it is.
  const places = new Map<string, ParentPlace | null>([[String(moved.id), parent]])
  const findParent = (parentId: Id | null) => (parentId === null ? null : places.get(String(parentId)))
  const move: BranchMove = { collection: slug, documents: [], documentsBelow: documentCount, versions: [] }
  const depthOf = ({ ancestors }: StoredDocument) => ancestors?.length ?? 0
  for (const document of below.sort((each, other) => depthOf(each) - depthOf(other))) {
    const record = readRecord({ document, version: versions.get(String(document.id)) }, 'place', collection, payload)
    const above = findParent(record.parentId)
    if (above === undefined) continue
    const place = workOutPlace(record, above, collection, payload)
    places.set(String(document.id), { ...place, id: document.id })
    if (!isSamePlace(place, readStoredPlace(document, slug, payload))) move.documents.push({ document, place })
  }
  for (const version of versions.values()) {
    const record = readRecord({ document: { ...version.version, id: version.parent }, version }, 'plan', collection, payload)
    const above = findParent(record.parentId)
    if (above === undefined) continue
    const plan = workOutPlace(record, above, collection, payload)
    if (!isSamePlace(plan, readStoredPlace(version.version, slug, payload))) move.versions.push({ plan, version })
  }
  const landings = move.documents.flatMap(({ document, place }) => {
    const storedPaths = readPaths(document.path, slug, payload)
    return Object.entries(place.paths).flatMap(([pathLocale, path]) =>
      path === null || path === storedPaths[pathLocale] ? [] : [{ document, locale: pathLocale, path }]
    )
  })
  for (const { document, locale: pathLocale, path } of landings) {
    // A top-level document with the root slug answers /, which a lifted document would not have before.
    const refusal =
      path === HOME_PAGE_PATH ? becomesHomePageRefusal(slug, document, pathLocale, req) : findReservedPathRefusal(path, payload)
    if (refusal) throw buildFieldError(slug, REFUSAL_FIELD, refusal, req, pathLocale)
  }
  const taken = await findTakenPath(
    landings.map(({ locale: pathLocale, path }) => [pathLocale, path]),
    { below, collection: slug, ids: [moved.id] },
    req
  )
  if (taken) throw buildFieldError(slug, REFUSAL_FIELD, describeTakenPath(taken, req), req, taken.locale)
  return move
}

export async function writeBranchMove({ collection, documents, versions }: BranchMove, req: PayloadRequest) {
  for (const { document, place } of documents) await writePlace(collection, document, place, req)
  for (const { plan, version } of versions) await writePlan(collection, version, plan, req)
}
