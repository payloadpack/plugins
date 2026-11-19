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

// Every read and write of the plugin goes through Payload's own database API, on the request, so it
// runs in the request's transaction where the database has one.

// A document as the database adapter returns it: localized values hold every locale, and the slug
// and the path are localized where isLocalized says so. Its parent is in the field
// getParentFieldName names.
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

// The documents of a collection as the database holds them, with every locale.
export async function findDocuments(collection: string, where: Where, req: PayloadRequest) {
  const { docs } = await req.payload.db.find<StoredDocument>({ collection, joins: false, pagination: false, req, where })
  return docs
}

// One document of a collection by its id, as the database holds it, with every locale.
export async function findDocumentById(collection: string, id: Id, req: PayloadRequest): Promise<StoredDocument | undefined> {
  const [document] = await findDocuments(collection, { id: { equals: id } }, req)
  return document
}

// One document of a collection that a where finds, as the database holds it, with every locale.
export const findDocument = (collection: string, where: Where, req: PayloadRequest) =>
  req.payload.db.findOne<StoredDocument>({ collection, joins: false, req, where })

type ChunkQuery = { limit: number; pagination: false; sort: string; where: Where }

/**
 * Every row a where finds, read a chunk at a time in the order of the ids, each read after the last
 * id of the one before. For a where on a relationship, Postgres and SQLite first select the ids it
 * finds and then ask for the rows with every one of those ids in one list, so a single read of a
 * branch would name each of its documents in one statement.
 */
export async function findInChunks<Row extends { id: Id }>(find: (query: ChunkQuery) => Promise<{ docs: Row[] }>, where: Where) {
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

// How many documents sit below a document, which is none in a collection without parents, where
// there are no ancestors to ask for.
export async function countBelow(collection: string, id: Id, req: PayloadRequest) {
  if (getParentFieldName(collection, req.payload) === undefined) return 0
  return (await req.payload.db.count({ collection, req, where: { ancestors: { equals: id } } })).totalDocs
}

// The path and ancestors the documents below a document hang from, which is what the document itself stores.
export async function findParentPathAndAncestors(
  collection: string,
  id: Id | null,
  req: PayloadRequest
): Promise<ParentPathAndAncestors | null> {
  if (id === null) return null
  const parent = await findDocumentById(collection, id, req)
  return parent ? { ...getStoredPathAndAncestors(parent, collection, req.payload), id: parent.id } : null
}

/**
 * A row with a path and ancestors stored in it. In a localized collection a locale without a path is
 * left out, so the write makes no row for a locale the document has no values in. In one that isn't,
 * every locale holds the same path, which is the one the row stores. A row's parent must agree with
 * its ancestors, so a row that holds another parent than the last of the ancestors, which the path
 * hangs from, gets that one: Payload writes a draft to the latest version only, and the row of a
 * document that isn't published follows that draft. A row that agrees is left as it is, so a parent
 * it doesn't hold is not invented: MongoDB stores none for a top-level document. A collection
 * without parents stores neither a parent nor ancestors.
 */
export function buildRowWithPathAndAncestors<Row extends Record<string, unknown>>(
  row: Row,
  { ancestors, paths }: PathAndAncestors,
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
 * This write and setDraftPathAndAncestors both send the whole row as it was read, with the path and
 * ancestors changed. On Postgres and SQLite an update that holds a localized value replaces every
 * locale's row of the document, and on MongoDB an update of a version replaces its whole content, so
 * a write of the path alone would empty the rest. Such a write undoes whatever a save wrote to the
 * row since it was read. The row keeps its updatedAt, because each adapter stamps a new one on a write
 * without it, so a save is what changes it.
 *
 * A write that comes long after its read, as a move's or a backfill's does, asks for ifUnchanged: it
 * lands only while the row still has the updatedAt it was read with, and says whether it landed, so
 * the caller reads the row again and decides again when a save came first. Without transactions on
 * Postgres and SQLite only the first statement of the write carries that condition. A row that holds
 * no updatedAt, as in a collection with timestamps: false, has nothing to compare and is written by its
 * id, as is every row without ifUnchanged.
 *
 * A write on the condition can also miss a row nobody saved: one whose updatedAt Payload didn't
 * write, such as text an import left on SQLite or a string on MongoDB, which the value Payload reads
 * back doesn't find in a where. So a miss reads the row again. A save stamps a new updatedAt, so a row
 * that still has the one it was read with wasn't saved since, and is written by its id as it is now.
 * A row that is gone, or has another updatedAt, says the write didn't land. That can't loop: the
 * caller tries again only after a save changed the row. A miss costs one more read, and such a row
 * the write by id that every row got before the condition.
 */
export async function setPathAndAncestors(
  collection: string,
  document: StoredDocument,
  pathAndAncestors: PathAndAncestors,
  req: PayloadRequest,
  { ifUnchanged = false }: { ifUnchanged?: boolean } = {}
): Promise<boolean> {
  const data = buildRowWithPathAndAncestors(document, pathAndAncestors, collection, req)
  const { id, updatedAt } = document
  if (!ifUnchanged || updatedAt == null) {
    await req.payload.db.updateOne({ collection, data, id, req, returning: false })
    return true
  }
  // Payload returns the row it wrote, and nothing when no row is as the where asks.
  const where: Where = { and: [{ id: { equals: id } }, { updatedAt: { equals: updatedAt } }] }
  if ((await req.payload.db.updateOne({ collection, data, req, where })) !== null) return true
  // Both values are read the same way, by findDocumentById, so they are alike whenever the row holds
  // the same one.
  const fresh = await findDocumentById(collection, id, req)
  if (!fresh || fresh.updatedAt !== updatedAt) return false
  return setPathAndAncestors(collection, fresh, pathAndAncestors, req)
}
