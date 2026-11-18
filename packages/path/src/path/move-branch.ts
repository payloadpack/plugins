import type { CollectionConfig, PayloadRequest } from 'payload'

import { countBelow, findDocumentsBelow, setPathAndAncestors, type StoredDocument } from '../database/documents.js'
import { findLatestVersionsBelow, setDraftPathAndAncestors, type StoredVersion } from '../database/versions.js'
import { getParentFieldName } from '../plugin/options.js'
import { hasDrafts } from '../utils/published-locales.js'
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
  document: StoredDocument
  // What the documents right below hang from now: the document with its new path and ancestors, for
  // a lift its parent, or nothing at the top level.
  parent: ParentPathAndAncestors | null
  req: PayloadRequest
}

// The rows of a branch that get another path or other ancestors than they store, top-down, each
// document with the paths its row stores, and every document the branch holds below its first.
export type BranchMove = {
  below: StoredDocument[]
  collection: string
  documents: { document: StoredDocument; pathAndAncestors: PathAndAncestors; storedPaths: Paths }[]
  versions: { pathAndAncestors: PathAndAncestors; version: StoredVersion }[]
}

/**
 * Finds where every document below a document is once that document has moved, or is deleted, and
 * where each latest version below it would put its document: top-down, each from its own slugs and
 * the new path and ancestors of its parent, by the one rule. It refuses nothing and stores nothing:
 * checkBranchMove refuses a move, and moveBranch stores one.
 */
export async function findBranchMove({ collection, document: moved, parent, req }: BranchMoveRequest): Promise<BranchMove> {
  const { payload } = req
  const { slug } = collection
  // In a collection without parents nothing sits below a document, so there is no branch to read.
  if (getParentFieldName(slug, payload) === undefined) return { below: [], collection: slug, documents: [], versions: [] }
  const documentCount = await countBelow(slug, moved.id, req)
  const below = documentCount > 0 ? await findDocumentsBelow(slug, moved.id, req) : []
  // The latest versions of those documents, and the ones whose draft would put their document below
  // the document while the document itself is elsewhere.
  const versions = hasDrafts(collection)
    ? await findLatestVersionsBelow(
        slug,
        moved.id,
        below.map(({ id }) => id),
        req
      )
    : new Map<string, StoredVersion>()
  // What each document that others hang from gives them now, by its id: the document itself its new
  // path and ancestors, and a deleted document the ones it hung from, so a lift needs no rule of its
  // own. A row that hangs from a document outside the branch stays as it is.
  const parents = new Map<string, ParentPathAndAncestors | null>([[String(moved.id), parent]])
  const getParent = (parentId: Id | null) => (parentId === null ? null : parents.get(String(parentId)))
  const move: BranchMove = { below, collection: slug, documents: [], versions: [] }
  const depthOf = ({ ancestors }: StoredDocument) => ancestors?.length ?? 0
  for (const document of below.sort((each, other) => depthOf(each) - depthOf(other))) {
    const slugsAndParent = getSlugsAndParent(
      { document, version: versions.get(String(document.id)) },
      'document',
      collection,
      payload
    )
    const above = getParent(slugsAndParent.parentId)
    if (above === undefined) continue
    const pathAndAncestors = buildPathAndAncestors(slugsAndParent, above, collection, payload)
    parents.set(String(document.id), { ...pathAndAncestors, id: document.id })
    const stored = getStoredPathAndAncestors(document, slug, payload)
    if (!hasSamePathAndAncestors(pathAndAncestors, stored)) {
      move.documents.push({ document, pathAndAncestors, storedPaths: stored.paths })
    }
  }
  for (const version of versions.values()) {
    const slugsAndParent = getSlugsAndParent(
      { document: { ...version.version, id: version.parent }, version },
      'draft',
      collection,
      payload
    )
    const above = getParent(slugsAndParent.parentId)
    if (above === undefined) continue
    const pathAndAncestors = buildPathAndAncestors(slugsAndParent, above, collection, payload)
    if (!hasSamePathAndAncestors(pathAndAncestors, getStoredPathAndAncestors(version.version, slug, payload))) {
      move.versions.push({ pathAndAncestors, version })
    }
  }
  return move
}

// Where a branch move puts each document that it gives another path, in each locale it does.
export const getLandings = ({ collection, documents }: BranchMove): TakenPath[] =>
  documents.flatMap(({ document, pathAndAncestors, storedPaths }) =>
    Object.entries(pathAndAncestors.paths).flatMap(([locale, path]) =>
      path === null || path === storedPaths[locale] ? [] : [{ collection, document, locale, path }]
    )
  )

export async function moveBranch({ collection, documents, versions }: BranchMove, req: PayloadRequest) {
  for (const { document, pathAndAncestors } of documents) await setPathAndAncestors(collection, document, pathAndAncestors, req)
  for (const { pathAndAncestors, version } of versions) await setDraftPathAndAncestors(collection, version, pathAndAncestors, req)
}
