import type { PayloadRequest, Where } from 'payload'

import {
  getStoredPathAndAncestors,
  idOf,
  type Id,
  type ParentPathAndAncestors,
  type PathAndAncestors
} from '../path/build-path-and-ancestors.js'
import { getParentFieldName, isLocalized } from '../plugin/options.js'
import { CHUNK_SIZE } from '../utils/in-chunks.js'

// As the database adapter returns it: a localized value holds every locale, and the parent is in the
// field getParentFieldName names.
export type StoredDocument = {
  [key: string]: unknown
  _status?: unknown
  ancestors?: Id[] | null
  // Set while the document is in the trash, in a collection that has one.
  deletedAt?: unknown
  id: Id
  path?: unknown
  slug?: unknown
}

export async function findDocuments(collection: string, where: Where, req: PayloadRequest) {
  const { docs } = await req.payload.db.find<StoredDocument>({ collection, joins: false, pagination: false, req, where })
  return docs
}

export async function findDocumentById(collection: string, id: Id, req: PayloadRequest): Promise<StoredDocument | undefined> {
  const [document] = await findDocuments(collection, { id: { equals: id } }, req)
  return document
}

export const findDocument = (collection: string, where: Where, req: PayloadRequest) =>
  req.payload.db.findOne<StoredDocument>({ collection, joins: false, req, where })

type ChunkQuery = { limit: number; pagination: false; sort: string; where: Where }

// For a where on a relationship, Postgres and SQLite first select the ids it finds and then ask for
// the rows with every one of those ids in one list. So the rows are read a chunk at a time, in the
// order of the ids, each read after the last id of the one before.
export async function findInChunks<Row extends { id: Id }>(find: (query: ChunkQuery) => Promise<{ docs: Row[] }>, where: Where) {
  const rows: Row[] = []
  for (let last: Id | undefined; ; last = rows.at(-1)!.id) {
    const after: Where = last === undefined ? where : { and: [where, { id: { greater_than: last } }] }
    const { docs } = await find({ limit: CHUNK_SIZE, pagination: false, sort: 'id', where: after })
    rows.push(...docs)
    if (docs.length < CHUNK_SIZE) return rows
  }
}

export const findDocumentsBelow = (collection: string, id: Id, req: PayloadRequest) =>
  findInChunks((query) => req.payload.db.find<StoredDocument>({ collection, joins: false, req, ...query }), {
    ancestors: { equals: id }
  })

export async function countBelow(collection: string, id: Id, req: PayloadRequest) {
  // A collection without parents has no ancestors to ask for.
  if (getParentFieldName(collection, req.payload) === undefined) return 0
  return (await req.payload.db.count({ collection, req, where: { ancestors: { equals: id } } })).totalDocs
}

export async function findParentPathAndAncestors(
  collection: string,
  id: Id | null,
  req: PayloadRequest
): Promise<ParentPathAndAncestors | null> {
  if (id === null) return null
  const parent = await findDocumentById(collection, id, req)
  return parent ? { ...getStoredPathAndAncestors(parent, collection, req.payload), id: parent.id } : null
}

export function buildPathAndAncestorsFields(
  row: Record<string, unknown>,
  { ancestors, paths }: PathAndAncestors,
  collection: string,
  req: PayloadRequest
): Record<string, unknown> {
  // A locale without a path is left out, so a write makes no row for a locale the document has no
  // values in.
  const localePaths = Object.fromEntries(Object.entries(paths).filter(([, path]) => path !== null))
  // In a collection that isn't localized every locale holds the same path.
  const path = isLocalized(collection, req.payload) ? localePaths : (Object.values(paths)[0] ?? null)
  const parentField = getParentFieldName(collection, req.payload)
  if (parentField === undefined) return { path }
  // A row without ancestors, as MongoDB holds one stored before the plugin, gets them even when empty.
  const storedAncestors = row.ancestors as Id[] | null | undefined
  // A row's parent must agree with its ancestors. Payload writes a draft to the latest version only,
  // and the row of a document that isn't published follows that draft, so the row can hold another
  // parent and gets the one the path hangs from. A row that agrees is left as it is, so no parent is
  // invented where MongoDB stores none for a top-level document.
  return {
    path,
    ...(storedAncestors?.join() === ancestors.join() ? {} : { ancestors }),
    ...(String(idOf(row[parentField])) === String(ancestors.at(-1) ?? null) ? {} : { [parentField]: ancestors.at(-1) ?? null })
  }
}

export const buildRowWithPathAndAncestors = <Row extends Record<string, unknown>>(
  row: Row,
  pathAndAncestors: PathAndAncestors,
  collection: string,
  req: PayloadRequest
) => ({ ...row, ...buildPathAndAncestorsFields(row, pathAndAncestors, collection, req) })

const isNoDate = (timestamp: unknown) => timestamp != null && Number.isNaN(new Date(timestamp as Date | string).getTime())

// The whole row is sent as it was read, with the path and ancestors changed: on Postgres and SQLite an
// update that holds a localized value replaces every locale's row of the document, so a write of the
// path alone would empty the rest. Such a write undoes what a save wrote to the row since the read.
// With ifUnchanged, for a write long after its read as a backfill's is, it lands only while the row
// still has the updatedAt it was read with, and says whether it landed.
export async function setPathAndAncestors(
  collection: string,
  document: StoredDocument,
  pathAndAncestors: PathAndAncestors,
  req: PayloadRequest,
  { ifUnchanged = false }: { ifUnchanged?: boolean } = {}
): Promise<boolean> {
  const { createdAt, id, updatedAt } = document
  // The row keeps its updatedAt, since each adapter stamps a new one on a write without it. So only a
  // save changes it.
  const data: Record<string, unknown> = buildRowWithPathAndAncestors(document, pathAndAncestors, collection, req)
  // A timestamp can be text that is no date, as an import may leave on MongoDB. Payload reads it and
  // the adapter refuses it in a write, so it is not sent back: an updatedAt of null tells each adapter
  // to leave the one the row holds, and a createdAt that isn't sent isn't written.
  if (isNoDate(createdAt)) delete data.createdAt
  if (isNoDate(updatedAt)) data.updatedAt = null
  if (!ifUnchanged || updatedAt == null || isNoDate(updatedAt)) {
    await req.payload.db.updateOne({ collection, data, id, req, returning: false })
    return true
  }
  // Payload returns the row it wrote, and nothing when no row is as the where asks.
  const where: Where = { and: [{ id: { equals: id } }, { updatedAt: { equals: updatedAt } }] }
  if ((await req.payload.db.updateOne({ collection, data, req, where })) !== null) return true
  // A miss is also what a row gives whose updatedAt Payload didn't write, such as text an import left
  // on SQLite, which the value Payload reads back doesn't find in a where. So the row is read again.
  // Both values are read the same way, so they are alike whenever the row holds the same one, and a
  // row that still has the updatedAt it was read with was not saved since: it is written by its id.
  const fresh = await findDocumentById(collection, id, req)
  if (!fresh || fresh.updatedAt !== updatedAt) return false
  return setPathAndAncestors(collection, fresh, pathAndAncestors, req)
}
