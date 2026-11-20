import type { CollectionConfig, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { lockBranch, setPathAndAncestorsFields } from '../database/branch.js'
import { buildPathAndAncestorsFields, countBelow, findDocumentsBelow, type StoredDocument } from '../database/documents.js'
import { findLatestVersionsBelow, type DocumentAndLatestVersion, type StoredVersion } from '../database/versions.js'
import { getParentFieldName } from '../plugin/options.js'
import type { TakenPath } from '../validation/find-taken-path.js'
import {
  buildPathAndAncestors,
  getSlugsAndParent,
  getStoredPathAndAncestors,
  hasSamePathAndAncestors,
  type Id,
  type ParentPathAndAncestors,
  type PathAndAncestors,
  type Paths
} from './build-path-and-ancestors.js'

type BranchMoveRequest = {
  collection: CollectionConfig
  // The document whose branch moves, or the deleted document whose branch is lifted.
  id: Id
  // What the documents right below hang from now: the document with its new path and ancestors, for
  // a lift its parent, or nothing at the top level.
  parent: ParentPathAndAncestors | null
  req: PayloadRequest
}

export type BranchMove = {
  // Every document below the one the id names, whether the move changes it or not.
  below: StoredDocument[]
  collection: string
  id: Id
  // Only the rows that get another path or other ancestors than they store, top-down.
  documents: { document: StoredDocument; pathAndAncestors: PathAndAncestors; storedPaths: Paths }[]
  versions: { pathAndAncestors: PathAndAncestors; version: StoredVersion }[]
}

export async function findBranchMove({ collection, id, parent, req }: BranchMoveRequest): Promise<BranchMove> {
  const { payload } = req
  const { slug } = collection
  const move: BranchMove = { below: [], collection: slug, documents: [], id, versions: [] }
  // In a collection without parents nothing sits below a document.
  if (getParentFieldName(slug, payload) === undefined) return move
  await lockBranch(slug, id, req)
  if ((await countBelow(slug, id, req)) > 0) move.below = await findDocumentsBelow(slug, id, req)
  const { below } = move
  const versions = hasDraftsEnabled(collection)
    ? await findLatestVersionsBelow(
        slug,
        id,
        below.map((document) => document.id),
        req
      )
    : new Map<string, StoredVersion>()
  // What each document that others hang from gives them now, by its id: the document itself its new
  // path and ancestors, and a deleted document the ones it hung from, so a lift needs no rule of its
  // own. A row that hangs from a document outside the branch stays as it is.
  const parents = new Map<string, ParentPathAndAncestors | null>([[String(id), parent]])
  const buildPathAndAncestorsBelow = (documentAndLatestVersion: DocumentAndLatestVersion, kind: 'document' | 'draft') => {
    const { parentId, slugs } = getSlugsAndParent(documentAndLatestVersion, kind, collection, payload)
    const newParent = parentId === null ? null : parents.get(String(parentId))
    return newParent === undefined ? undefined : buildPathAndAncestors(slugs, newParent, collection, payload)
  }
  const getDepth = ({ ancestors }: StoredDocument) => ancestors?.length ?? 0
  for (const document of below.sort((upper, lower) => getDepth(upper) - getDepth(lower))) {
    const pathAndAncestors = buildPathAndAncestorsBelow({ document, version: versions.get(String(document.id)) }, 'document')
    if (!pathAndAncestors) continue
    parents.set(String(document.id), { ...pathAndAncestors, id: document.id })
    const storedPathAndAncestors = getStoredPathAndAncestors(document, slug, payload)
    if (!hasSamePathAndAncestors(pathAndAncestors, storedPathAndAncestors)) {
      move.documents.push({ document, pathAndAncestors, storedPaths: storedPathAndAncestors.paths })
    }
  }
  for (const version of versions.values()) {
    const pathAndAncestors = buildPathAndAncestorsBelow(
      { document: { ...version.version, id: version.parent }, version },
      'draft'
    )
    const storedPathAndAncestors = getStoredPathAndAncestors(version.version, slug, payload)
    if (pathAndAncestors && !hasSamePathAndAncestors(pathAndAncestors, storedPathAndAncestors)) {
      move.versions.push({ pathAndAncestors, version })
    }
  }
  return move
}

// Only the documents the move gives another path, in the locales where it does.
export const getLandings = ({ collection, documents }: BranchMove): TakenPath[] =>
  documents.flatMap(({ document, pathAndAncestors, storedPaths }) =>
    Object.entries(pathAndAncestors.paths).flatMap(([locale, path]) =>
      path === null || path === storedPaths[locale] ? [] : [{ collection, document, locale, path }]
    )
  )

// A row that a save gave another slug or parent between the move's read of it and this write gets the
// path the move built from the row it read, until its next save or a run of backfillPaths.
export async function moveBranch({ collection, documents, versions }: BranchMove, req: PayloadRequest) {
  const getFields = (row: Record<string, unknown>, pathAndAncestors: PathAndAncestors) =>
    buildPathAndAncestorsFields(row, pathAndAncestors, collection, req)
  await setPathAndAncestorsFields(
    collection,
    'documents',
    documents.map(({ document, pathAndAncestors }) => ({ fields: getFields(document, pathAndAncestors), id: document.id })),
    req
  )
  await setPathAndAncestorsFields(
    collection,
    'versions',
    versions.map(({ pathAndAncestors, version }) => ({ fields: getFields(version.version, pathAndAncestors), id: version.id })),
    req
  )
}
