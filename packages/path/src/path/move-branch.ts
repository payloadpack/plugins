import type { CollectionConfig, CollectionSlug, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { countBelow, findDocumentsBelow, setPathAndAncestors, type StoredDocument } from '../database/documents.js'
import {
  findDocumentAndLatestVersion,
  findLatestVersion,
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
  hasSameSlugsAndParent,
  type Id,
  type ParentPathAndAncestors,
  type PathAndAncestors,
  type Paths,
  type SlugsAndParent
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
// with the slugs and the parent its path and ancestors are built from, each document with the paths
// its row stores, and every document the branch holds below its first, which the id names.
export type BranchMove = {
  below: StoredDocument[]
  collection: string
  id: Id
  documents: {
    document: StoredDocument
    pathAndAncestors: PathAndAncestors
    slugsAndParent: SlugsAndParent
    storedPaths: Paths
  }[]
  versions: { pathAndAncestors: PathAndAncestors; slugsAndParent: SlugsAndParent; version: StoredVersion }[]
}

/**
 * Finds where every document below a document is once that document has moved, or is deleted, and
 * where each latest version below it would put its document: top-down, each from its own slugs and
 * the new path and ancestors of its parent, by the one rule. It refuses nothing and stores nothing:
 * checkBranchMove refuses a move, and moveBranch stores one, from the rows as they are when it gets
 * to each.
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
  // The path and ancestors a row gets below its parent's new ones, with what they are built from, or
  // nothing for a row that stays.
  const buildBelow = (stored: DocumentAndLatestVersion, kind: 'document' | 'draft') => {
    const slugsAndParent = getSlugsAndParent(stored, kind, collection, payload)
    const { parentId, slugs } = slugsAndParent
    const above = parentId === null ? null : parents.get(String(parentId))
    return above === undefined
      ? undefined
      : { pathAndAncestors: buildPathAndAncestors(slugs, above, collection, payload), slugsAndParent }
  }
  const depthOf = ({ ancestors }: StoredDocument) => ancestors?.length ?? 0
  for (const document of below.sort((each, other) => depthOf(each) - depthOf(other))) {
    const built = buildBelow({ document, version: versions.get(String(document.id)) }, 'document')
    if (!built) continue
    parents.set(String(document.id), { ...built.pathAndAncestors, id: document.id })
    const stored = getStoredPathAndAncestors(document, slug, payload)
    if (!hasSamePathAndAncestors(built.pathAndAncestors, stored)) {
      move.documents.push({ document, ...built, storedPaths: stored.paths })
    }
  }
  for (const version of versions.values()) {
    const built = buildBelow({ document: { ...version.version, id: version.parent }, version }, 'draft')
    if (built && !hasSamePathAndAncestors(built.pathAndAncestors, getStoredPathAndAncestors(version.version, slug, payload))) {
      move.versions.push({ ...built, version })
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
 * Stores a branch move, top-down: the documents first, and then the latest versions. A move of a big
 * branch takes a while, and a save of a document below may land meanwhile, so each row is read again
 * right before its write: a document with its latest version, and a latest version found again,
 * since a save may have made a newer one. A row that is gone is skipped, and so is one whose slugs or
 * parent are no longer the ones its path and ancestors were built from: the save that changed them
 * gave the document a path in its own hooks, and a write here would undo that save. The rows below a
 * document skipped so are skipped too, since the move built their paths from its old ones and its
 * save gave them theirs. Every other row is written as it is now, with the path and ancestors the
 * move built. A document's row is written only while it is as it was read here, so a save that lands
 * between the read and the write is kept: the row is read again and decided again, as many times as a
 * save comes first.
 *
 * This narrows what two requests at once can do to each other, and closes none of it. A latest
 * version is written by its id, so a save between its read here and its write is written over. A row
 * deleted in the moment the move writes it comes back on Postgres, and by the adapter's source on
 * SQLite too, where the write is an insert that updates the row when it is there. And a save that changed a row's slugs or parent
 * before the move wrote that row's parent built its path from the parent's old one, so the skipped
 * row is left at a path below where its parent was, until a run of backfillPaths.
 */
export async function moveBranch({ collection, documents, versions }: BranchMove, req: PayloadRequest) {
  const { config } = req.payload.collections[collection as CollectionSlug]
  const isBuiltFrom = (stored: DocumentAndLatestVersion, kind: 'document' | 'draft', slugsAndParent: SlugsAndParent) =>
    hasSameSlugsAndParent(getSlugsAndParent(stored, kind, config, req.payload), slugsAndParent)
  // Writes a document's row as it is now, with the path and ancestors the move built, and says
  // whether it did: not for a row that is gone or no longer built from the same slugs and parent.
  const findAndSetPathAndAncestors = async (
    id: Id,
    pathAndAncestors: PathAndAncestors,
    slugsAndParent: SlugsAndParent
  ): Promise<boolean> => {
    const stored = await findDocumentAndLatestVersion(config, id, req)
    if (!stored || !isBuiltFrom(stored, 'document', slugsAndParent)) return false
    const landed = await setPathAndAncestors(collection, stored.document, pathAndAncestors, req, { ifUnchanged: true })
    return landed || (await findAndSetPathAndAncestors(id, pathAndAncestors, slugsAndParent))
  }
  const skipped = new Set<string>()
  const isBelowSkipped = ({ ancestors }: PathAndAncestors) => ancestors.some((ancestor) => skipped.has(String(ancestor)))
  for (const { document, pathAndAncestors, slugsAndParent } of documents) {
    if (isBelowSkipped(pathAndAncestors) || !(await findAndSetPathAndAncestors(document.id, pathAndAncestors, slugsAndParent))) {
      skipped.add(String(document.id))
    }
  }
  for (const { pathAndAncestors, slugsAndParent, version: read } of versions) {
    if (isBelowSkipped(pathAndAncestors)) continue
    const version = await findLatestVersion(collection, read.parent, req)
    if (version && isBuiltFrom({ document: { ...version.version, id: version.parent }, version }, 'draft', slugsAndParent)) {
      await setDraftPathAndAncestors(collection, version, pathAndAncestors, req)
    }
  }
}
