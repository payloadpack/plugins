import type { CollectionConfig, PayloadRequest, Where } from 'payload'

import { hasDraftsEnabled } from 'payload/shared'

import {
  buildPathAndAncestors,
  getSlugsAndParent,
  getStoredPathAndAncestors,
  hasSamePathAndAncestors,
  type Id,
  type PathAndAncestors
} from '../path/build-path-and-ancestors.js'
import { inChunks } from '../utils/in-chunks.js'
import {
  buildRowWithPathAndAncestors,
  findDocumentById,
  findInChunks,
  findParentPathAndAncestors,
  setPathAndAncestors,
  type StoredDocument
} from './documents.js'

// A version as the database adapter returns it. Its own parent is the document it is a version of.
export type StoredVersion = { [key: string]: unknown; id: Id; parent: Id; version: Omit<StoredDocument, 'id'> }

// The id of the document a version is of, or nothing for a version that isn't stored.
export async function findDocumentIdOfVersion(collection: string, id: Id, req: PayloadRequest): Promise<Id | undefined> {
  const { docs } = await req.payload.db.findVersions({
    collection,
    limit: 1,
    pagination: false,
    req,
    where: { id: { equals: id } }
  })
  return (docs[0] as StoredVersion | undefined)?.parent
}

// A document as the database holds it: the document itself and, in a collection with drafts, its
// latest version.
export type DocumentAndLatestVersion = { document: StoredDocument; version?: StoredVersion }

const LATEST: Where = { latest: { equals: true } }

// The latest versions among a collection's versions, newest first, as Payload itself finds one.
async function findLatestVersions(collection: string, where: Where, req: PayloadRequest) {
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

// The latest version of each document of a collection, by the document's id.
export async function findLatestVersionByDocument(collection: string, req: PayloadRequest) {
  return keepNewest(new Map(), await findLatestVersions(collection, {}, req))
}

/**
 * The latest versions a move of the documents below a document reaches, by their document's id:
 * those of the documents below it, and those whose draft would put their document below it while
 * the document itself is elsewhere. The documents are named a chunk at a time. The question that
 * names the first chunk also asks for the versions whose draft would put their document below, and
 * is read a chunk at a time, so a branch that fits in one chunk takes one question.
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

// A document's latest version as the database holds it, or nothing for a document without one.
export async function findLatestVersion(collection: string, id: Id, req: PayloadRequest): Promise<StoredVersion | undefined> {
  const [version] = await findLatestVersions(collection, { parent: { equals: id } }, req)
  return version
}

export async function findDocumentAndLatestVersion(
  collection: CollectionConfig,
  id: Id,
  req: PayloadRequest
): Promise<DocumentAndLatestVersion | undefined> {
  const document = await findDocumentById(collection.slug, id, req)
  if (!document) return
  if (!hasDraftsEnabled(collection)) return { document }
  return { document, version: await findLatestVersion(collection.slug, id, req) }
}

// A stored document's path and ancestors, or the ones its latest draft would give it, below the
// parent that counts for it as that parent is stored.
export async function findParentAndBuildPathAndAncestors(
  stored: DocumentAndLatestVersion,
  kind: 'document' | 'draft',
  collection: CollectionConfig,
  req: PayloadRequest
) {
  const slugsAndParent = getSlugsAndParent(stored, kind, collection, req.payload)
  const parent = await findParentPathAndAncestors(collection.slug, slugsAndParent.parentId, req)
  return buildPathAndAncestors(slugsAndParent.slugs, parent, collection, req.payload)
}

// MongoDB changes the object it is given, so the row it is made from is not read again afterwards.
export async function setDraftPathAndAncestors(
  collection: string,
  version: StoredVersion,
  pathAndAncestors: PathAndAncestors,
  req: PayloadRequest
) {
  const versionData = { ...version, version: buildRowWithPathAndAncestors(version.version, pathAndAncestors, collection, req) }
  await req.payload.db.updateVersion({ collection, id: version.id, req, returning: false, versionData })
}

/**
 * Stores a document's path and ancestors, and the ones its latest draft would give it, in each of
 * the two rows that stores other ones, and says which of them it wrote.
 */
export async function setDocumentAndDraftPathAndAncestors(
  collection: string,
  { document, version }: DocumentAndLatestVersion,
  built: { document: PathAndAncestors; draft: PathAndAncestors },
  req: PayloadRequest
) {
  const isOther = (row: Omit<StoredDocument, 'id'>, pathAndAncestors: PathAndAncestors) =>
    !hasSamePathAndAncestors(pathAndAncestors, getStoredPathAndAncestors(row, collection, req.payload))
  const wrote = {
    document: isOther(document, built.document),
    draft: version !== undefined && isOther(version.version, built.draft)
  }
  if (wrote.document) await setPathAndAncestors(collection, document, built.document, req)
  if (version && wrote.draft) await setDraftPathAndAncestors(collection, version, built.draft, req)
  return wrote
}
