import type { CollectionConfig, PayloadRequest, Where } from 'payload'

import { getParentFieldName, isLocalized } from '../plugin/options.js'
import {
  idOf,
  readRecord,
  readStoredPlace,
  workOutPlace,
  type Id,
  type ParentPlace,
  type Place,
  type Stored,
  type StoredDocument,
  type StoredVersion
} from './place.js'
import { hasDrafts } from './status.js'

// Every read and write of the plugin goes through Payload's own database API, on the request, so it
// runs in the request's transaction where the database has one.

// The documents of a collection as the database holds them, with every locale.
export async function findDocuments(collection: string, where: Where, req: PayloadRequest) {
  const { docs } = await req.payload.db.find<StoredDocument>({ collection, joins: false, pagination: false, req, where })
  return docs
}

// The latest versions among a collection's versions, newest first, as Payload itself finds one.
export async function findLatestVersions(collection: string, where: Where, req: PayloadRequest) {
  const { docs } = await req.payload.db.findVersions<StoredVersion['version']>({
    collection,
    pagination: false,
    req,
    sort: '-updatedAt',
    where: { and: [where, { latest: { equals: true } }] }
  })
  return docs as StoredVersion[]
}

// Each document's latest version among a collection's versions, by the document's id.
export async function findLatestVersionByDocument(collection: string, where: Where, req: PayloadRequest) {
  const versions = new Map<string, StoredVersion>()
  for (const version of await findLatestVersions(collection, where, req)) {
    if (!versions.has(String(version.parent))) versions.set(String(version.parent), version)
  }
  return versions
}

export async function readStored(collection: CollectionConfig, id: Id, req: PayloadRequest): Promise<Stored | undefined> {
  const [document] = await findDocuments(collection.slug, { id: { equals: id } }, req)
  if (!document) return
  if (!hasDrafts(collection)) return { document }
  const [version] = await findLatestVersions(collection.slug, { parent: { equals: id } }, req)
  return { document, version }
}

// The place the documents below a document hang from, which is what the document itself stores.
export async function readParentPlace(collection: string, id: Id | null, req: PayloadRequest): Promise<ParentPlace | null> {
  if (id === null) return null
  const [parent] = await findDocuments(collection, { id: { equals: id } }, req)
  return parent ? { ...readStoredPlace(parent, collection, req.payload), id: parent.id } : null
}

// A stored document's place, or its plan, below the parent that counts for it as that parent is stored.
export async function workOutStoredPlace(
  stored: Stored,
  kind: 'place' | 'plan',
  collection: CollectionConfig,
  req: PayloadRequest
) {
  const record = readRecord(stored, kind, collection, req.payload)
  return workOutPlace(record, await readParentPlace(collection.slug, record.parentId, req), collection, req.payload)
}

/**
 * A row with a place stored in it. In a localized collection a locale without a path is left out, so
 * the write makes no row for a locale the document has no values in. In one that isn't, every locale
 * holds the same path, which is the one the row stores. A row's parent must agree with its
 * ancestors, so a row that holds another parent than the place hangs from, the last of the
 * ancestors, gets that one: Payload writes a draft to the latest version only, and the row of a
 * document that isn't published follows that draft. A row that agrees is left as it is, so a parent
 * it doesn't hold is not invented: MongoDB stores none for a top-level document. A collection
 * without parents stores neither a parent nor ancestors.
 */
function storePlace<Row extends Record<string, unknown>>(
  row: Row,
  { ancestors, paths }: Place,
  collection: string,
  req: PayloadRequest
) {
  const localePaths = Object.fromEntries(Object.entries(paths).filter(([, path]) => path !== null))
  const path = isLocalized(collection, req.payload) ? localePaths : (Object.values(paths)[0] ?? null)
  const parentField = getParentFieldName(collection, req.payload)
  if (parentField === undefined) return { ...row, path }
  const parentId = ancestors.at(-1) ?? null
  const agrees = String(idOf(row[parentField])) === String(parentId)
  return { ...row, ancestors, path, ...(agrees ? {} : { [parentField]: parentId }) }
}

/**
 * Both writes send the whole row as it was read, with the place changed. On Postgres and SQLite an
 * update that holds a localized value replaces every locale's row of the document, and on MongoDB an
 * update of a version replaces its whole content, so a write of the path alone would empty the rest.
 * The row keeps its updatedAt, because each adapter stamps a new one on a write without it.
 */
export async function writePlace(collection: string, document: StoredDocument, place: Place, req: PayloadRequest) {
  const data = storePlace(document, place, collection, req)
  await req.payload.db.updateOne({ collection, data, id: document.id, req, returning: false })
}

// MongoDB changes the object it is given, so the row it is made from is not read again afterwards.
export async function writePlan(collection: string, version: StoredVersion, plan: Place, req: PayloadRequest) {
  const versionData = { ...version, version: storePlace(version.version, plan, collection, req) }
  await req.payload.db.updateVersion({ collection, id: version.id, req, returning: false, versionData })
}
