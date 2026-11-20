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

// The rows of a branch that get another path or other ancestors than they store, top-down, each
// document with the paths its row stores, and every document the branch holds below its first, which
// the id names.
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
 * checkBranchMove refuses a move, and moveBranch stores one. It locks the branch first where the
 * database can, so no other save changes it before the request ends.
 */
export async function findBranchMove({ collection, id, parent, req }: BranchMoveRequest): Promise<BranchMove> {
  const { payload } = req
  const { slug } = collection
  const move: BranchMove = { below: [], collection: slug, documents: [], id, versions: [] }
  // In a collection without parents nothing sits below a document, so there is no branch to read.
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
  // The path and ancestors a row gets below its parent's new ones, or nothing for a row that stays.
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

// Where a branch move puts each document that it gives another path, in each locale it does.
export const getLandings = ({ collection, documents }: BranchMove): TakenPath[] =>
  documents.flatMap(({ document, pathAndAncestors, storedPaths }) =>
    Object.entries(pathAndAncestors.paths).flatMap(([locale, path]) =>
      path === null || path === storedPaths[locale] ? [] : [{ collection, document, locale, path }]
    )
  )

/**
 * Stores a branch move: the path and ancestors the move built for each row, of the documents and then
 * of the latest versions, each kind a chunk of rows at a time, in a few statements per chunk. They write
 * the path, the ancestors and the parent alone, so a save below that lands while the branch moves
 * keeps every other value. A row a save gave another slug or parent between the move's read of it
 * and these statements gets the path the move built from the row it read, until its next save or a
 * run of backfillPaths.
 */
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
