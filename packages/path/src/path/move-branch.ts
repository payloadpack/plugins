import type { CollectionConfig, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { countBelow, findDocumentsBelow, setPathAndAncestors, type StoredDocument } from '../database/documents.js'
import {
  findLatestVersionsBelow,
  setDraftPathAndAncestors,
  type DocumentAndLatestVersion,
  type StoredVersion
} from '../database/versions.js'
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

// The rows of a branch that get another path or other ancestors than they store, top-down, each
// document with the paths its row stores, and every document the branch holds below its first,
// which the id names.
export type BranchMove = {
  below: StoredDocument[]
  collection: string
  id: Id
  documents: { document: StoredDocument; pathAndAncestors: PathAndAncestors; storedPaths: Paths }[]
  versions: { pathAndAncestors: PathAndAncestors; version: StoredVersion }[]
}

/**
 * Finds where every document below a document is once that document has moved, or is deleted, and
 * where each latest version below it would put its document: top-down, each from its own slugs and
 * the new path and ancestors of its parent, by the one rule. It refuses nothing and stores nothing:
 * checkBranchMove refuses a move, and moveBranch stores one.
 */
export async function findBranchMove({ collection, id, parent, req }: BranchMoveRequest): Promise<BranchMove> {
  const { payload } = req
  const { slug } = collection
  const move: BranchMove = { below: [], collection: slug, documents: [], id, versions: [] }
  // In a collection without parents nothing sits below a document, so there is no branch to read.
  if (getParentFieldName(slug, payload) === undefined) return move
  if ((await countBelow(slug, id, req)) > 0) move.below = await findDocumentsBelow(slug, id, req)
  const { below } = move
  // The latest versions of those documents, and the ones whose draft would put their document below
  // the document while the document itself is elsewhere.
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
  // The path and ancestors a row gets below its parent's new ones, or nothing for a row that stays.
  const buildBelow = (stored: DocumentAndLatestVersion, kind: 'document' | 'draft') => {
    const { parentId, slugs } = getSlugsAndParent(stored, kind, collection, payload)
    const above = parentId === null ? null : parents.get(String(parentId))
    return above === undefined ? undefined : buildPathAndAncestors(slugs, above, collection, payload)
  }
  const depthOf = ({ ancestors }: StoredDocument) => ancestors?.length ?? 0
  for (const document of below.sort((each, other) => depthOf(each) - depthOf(other))) {
    const pathAndAncestors = buildBelow({ document, version: versions.get(String(document.id)) }, 'document')
    if (!pathAndAncestors) continue
    parents.set(String(document.id), { ...pathAndAncestors, id: document.id })
    const stored = getStoredPathAndAncestors(document, slug, payload)
    if (!hasSamePathAndAncestors(pathAndAncestors, stored)) {
      move.documents.push({ document, pathAndAncestors, storedPaths: stored.paths })
    }
  }
  for (const version of versions.values()) {
    const pathAndAncestors = buildBelow({ document: { ...version.version, id: version.parent }, version }, 'draft')
    if (
      pathAndAncestors &&
      !hasSamePathAndAncestors(pathAndAncestors, getStoredPathAndAncestors(version.version, slug, payload))
    ) {
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
