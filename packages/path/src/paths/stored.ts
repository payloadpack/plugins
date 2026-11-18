import type { CollectionConfig, PayloadRequest, Where } from 'payload'

import { getParentFieldName, isLocalized } from '../plugin/options.js'
import { CHUNK_SIZE, inChunks } from './chunks.js'
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

type ChunkQuery = { limit: number; pagination: false; sort: string; where: Where }

/**
 * Every row a where finds, read a chunk at a time in the order of the ids, each read after the last
 * id of the one before. For a where on a relationship, Postgres and SQLite first select the ids it
 * finds and then ask for the rows with every one of those ids in one list, so a single read of a
 * branch would name each of its documents in one statement.
 */
async function findInChunks<Row extends { id: Id }>(find: (query: ChunkQuery) => Promise<{ docs: Row[] }>, where: Where) {
  const rows: Row[] = []
  for (let last: Id | undefined; ; last = rows.at(-1)!.id) {
    const after: Where = last === undefined ? where : { and: [where, { id: { greater_than: last } }] }
    const { docs } = await find({ limit: CHUNK_SIZE, pagination: false, sort: 'id', where: after })
    rows.push(...docs)
    if (docs.length < CHUNK_SIZE) return rows
  }
}

// The documents below a document, at any depth, as the database holds them, with every locale.
export const findDocumentsBelow = (collection: string, id: Id, req: PayloadRequest) =>
  findInChunks((query) => req.payload.db.find<StoredDocument>({ collection, joins: false, req, ...query }), {
    ancestors: { equals: id }
  })

const LATEST: Where = { latest: { equals: true } }

// The latest versions among a collection's versions, newest first, as Payload itself finds one.
export async function findLatestVersions(collection: string, where: Where, req: PayloadRequest) {
  const { docs } = await req.payload.db.findVersions<StoredVersion['version']>({
    collection,
    pagination: false,
    req,
    sort: '-updatedAt',
    where: { and: [where, LATEST] }
  })
  return docs as StoredVersion[]
}

const updatedAtOf = ({ updatedAt }: StoredVersion) => new Date(updatedAt as Date | string).getTime()

// Keeps each document's newest version among the ones found, by the document's id.
function keepNewest(versions: Map<string, StoredVersion>, found: StoredVersion[]) {
  for (const version of found) {
    const known = versions.get(String(version.parent))
    if (!known || updatedAtOf(known) < updatedAtOf(version)) versions.set(String(version.parent), version)
  }
  return versions
}

// Each document's latest version among a collection's versions, by the document's id.
export async function findLatestVersionByDocument(collection: string, where: Where, req: PayloadRequest) {
  return keepNewest(new Map(), await findLatestVersions(collection, where, req))
}

/**
 * The latest versions a move of the documents below a document reaches, by their document's id:
 * those of the documents below it, and those that plan a place below it while their own document is
 * elsewhere. The documents are named a chunk at a time. The question that names the first chunk
 * also asks for the versions that plan a place below, and is read a chunk at a time, so a branch
 * that fits in one chunk takes one question.
 */
export async function findLatestVersionsBelow(collection: string, id: Id, below: Id[], req: PayloadRequest) {
  const [first = [], ...rest] = inChunks(below)
  const reached: Where = {
    or: [{ 'version.ancestors': { equals: id } }, ...(first.length > 0 ? [{ parent: { in: first } }] : [])]
  }
  const found = await findInChunks(
    (query) => req.payload.db.findVersions<StoredVersion['version']>({ collection, req, ...query }),
    { and: [reached, LATEST] }
  )
  const versions = keepNewest(new Map(), found as StoredVersion[])
  for (const ids of rest) keepNewest(versions, await findLatestVersions(collection, { parent: { in: ids } }, req))
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
