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

// A version's own parent is the document it is a version of.
export type StoredVersion = { [key: string]: unknown; id: Id; parent: Id; version: Omit<StoredDocument, 'id'> }

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

export type DocumentAndLatestVersion = { document: StoredDocument; version?: StoredVersion }

const LATEST: Where = { latest: { equals: true } }

// Newest first, as Payload itself finds a latest version.
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

function keepNewest(versions: Map<string, StoredVersion>, found: StoredVersion[]) {
  for (const version of found) {
    const known = versions.get(String(version.parent))
    if (!known || updatedAtOf(known) < updatedAtOf(version)) versions.set(String(version.parent), version)
  }
  return versions
}

export async function findLatestVersionByDocument(collection: string, req: PayloadRequest) {
  return keepNewest(new Map(), await findLatestVersions(collection, {}, req))
}

// A move reaches the latest versions of the documents below, and those whose draft would put their
// document below while the document itself is elsewhere. The read that names the first chunk of
// documents asks for those too, so a branch that fits in one chunk takes one read.
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

async function findLatestVersion(collection: string, id: Id, req: PayloadRequest): Promise<StoredVersion | undefined> {
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

// The whole row is sent, since on MongoDB an update of a version replaces its whole content, and by
// its id, so a save of that version between its read and this write is written over. MongoDB changes
// the object it is given, so the row it is made from is not read again afterwards.
export async function setDraftPathAndAncestors(
  collection: string,
  version: StoredVersion,
  pathAndAncestors: PathAndAncestors,
  req: PayloadRequest
) {
  const versionData = { ...version, version: buildRowWithPathAndAncestors(version.version, pathAndAncestors, collection, req) }
  await req.payload.db.updateVersion({ collection, id: version.id, req, returning: false, versionData })
}

type DocumentAndDraft = { document: PathAndAncestors; draft: PathAndAncestors }
type Wrote = { document: boolean; draft: boolean }

// With ifUnchanged, a save that came first means neither row is written and nothing is returned: the
// draft's path and ancestors were built from the rows that save changed.
export function setDocumentAndDraftPathAndAncestors(
  collection: string,
  stored: DocumentAndLatestVersion,
  built: DocumentAndDraft,
  req: PayloadRequest
): Promise<Wrote>
export function setDocumentAndDraftPathAndAncestors(
  collection: string,
  stored: DocumentAndLatestVersion,
  built: DocumentAndDraft,
  req: PayloadRequest,
  options: { ifUnchanged: true }
): Promise<Wrote | undefined>
export async function setDocumentAndDraftPathAndAncestors(
  collection: string,
  { document, version }: DocumentAndLatestVersion,
  built: DocumentAndDraft,
  req: PayloadRequest,
  { ifUnchanged = false }: { ifUnchanged?: boolean } = {}
): Promise<Wrote | undefined> {
  const isOther = (row: Omit<StoredDocument, 'id'>, pathAndAncestors: PathAndAncestors) =>
    !hasSamePathAndAncestors(pathAndAncestors, getStoredPathAndAncestors(row, collection, req.payload))
  const wrote = {
    document: isOther(document, built.document),
    draft: version !== undefined && isOther(version.version, built.draft)
  }
  if (wrote.document && !(await setPathAndAncestors(collection, document, built.document, req, { ifUnchanged }))) return
  if (version && wrote.draft) await setDraftPathAndAncestors(collection, version, built.draft, req)
  return wrote
}
