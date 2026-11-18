import type { CollectionConfig, PayloadRequest, Where } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { buildPathAndAncestors, getSlugsAndParent, type Id, type PathAndAncestors } from '../path/build-path-and-ancestors.js'
import { inChunks } from '../utils/in-chunks.js'
import {
  buildRowWithPathAndAncestors,
  findDocuments,
  findInChunks,
  findParentPathAndAncestors,
  type StoredDocument
} from './documents.js'

// A version as the database adapter returns it. Its own parent is the document it is a version of.
export type StoredVersion = { [key: string]: unknown; id: Id; parent: Id; version: Omit<StoredDocument, 'id'> }

// A document as the database holds it: the document itself and, in a collection with drafts, its
// latest version.
export type DocumentAndLatestVersion = { document: StoredDocument; version?: StoredVersion }

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

export async function findDocumentAndLatestVersion(
  collection: CollectionConfig,
  id: Id,
  req: PayloadRequest
): Promise<DocumentAndLatestVersion | undefined> {
  const [document] = await findDocuments(collection.slug, { id: { equals: id } }, req)
  if (!document) return
  if (!hasDraftsEnabled(collection)) return { document }
  const [version] = await findLatestVersions(collection.slug, { parent: { equals: id } }, req)
  return { document, version }
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
  return buildPathAndAncestors(slugsAndParent, parent, collection, req.payload)
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
