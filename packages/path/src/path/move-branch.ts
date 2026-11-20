import type { CollectionConfig, CollectionSlug, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { lockBranch, setPathAndAncestorsBelow } from '../database/branch.js'
import {
  countBelow,
  findDocumentsBelow,
  hasParentOfAncestors,
  setPathAndAncestors,
  type StoredDocument
} from '../database/documents.js'
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
import { getStartsBelow, type StartsBelow } from './starts-below.js'

export type BranchMoveRequest = {
  collection: CollectionConfig
  // Where the document was before the move, which the paths below start with, or nothing where that
  // isn't known.
  from: PathAndAncestors | undefined
  // The document whose branch moves, or the deleted document whose branch is lifted.
  id: Id
  // What the documents right below hang from now: the document with its new path and ancestors, for
  // a lift its parent, or nothing at the top level.
  parent: ParentPathAndAncestors | null
  req: PayloadRequest
}

// A row that the move or its statements change, with the path and ancestors the move built for it,
// the slugs and parent they are built from, and whether the statements can't give it those, so it
// needs a write of its own.
type RowMove = { needsOwnWrite: boolean; pathAndAncestors: PathAndAncestors; slugsAndParent: SlugsAndParent }

// The rows a move changes, top-down, each document with the paths its row stores, and every document
// the branch holds below its first, which the id names, with what the statements write into the rows
// below it.
export type BranchMove = {
  below: StoredDocument[]
  collection: string
  documents: (RowMove & { document: StoredDocument; storedPaths: Paths })[]
  id: Id
  starts: StartsBelow
  versions: (RowMove & { version: StoredVersion })[]
}

/**
 * What the statements make of what a row stores. They find a row by the moved document among its
 * ancestors, and leave any other row as it is. In a row they find, the new start replaces the old one
 * in each locale whose path starts with it, and the new ancestors replace the ones up to and including
 * the first time the moved document comes.
 */
function buildReplacedPathAndAncestors({ ancestors, paths }: PathAndAncestors, id: Id, starts: StartsBelow): PathAndAncestors {
  const movedDocumentIndex = ancestors.findIndex((ancestor) => String(ancestor) === String(id))
  if (movedDocumentIndex === -1) return { ancestors, paths }
  const replacedPaths = { ...paths }
  for (const { from, locale, to } of starts.paths) {
    const path = paths[locale]
    if (path?.startsWith(`${from}/`)) replacedPaths[locale] = `${to}${path.slice(from.length)}`
  }
  const ancestorsBelowMovedDocument = ancestors.slice(movedDocumentIndex + 1)
  return {
    ancestors: starts.ancestors ? [...starts.ancestors, ...ancestorsBelowMovedDocument] : ancestors,
    paths: replacedPaths
  }
}

/**
 * Finds where every document below a document is once that document has moved, or is deleted, and
 * where each latest version below it would put its document: top-down, each from its own slugs and
 * the new path and ancestors of its parent, by the one rule. It refuses nothing and stores nothing:
 * checkBranchMove refuses a move, and moveBranch stores one. It locks the branch first where the
 * database can, so no other save changes it before the request ends.
 */
export async function findBranchMove({ collection, from, id, parent, req }: BranchMoveRequest): Promise<BranchMove> {
  const { payload } = req
  const { slug } = collection
  const starts = getStartsBelow(slug, { from, id, parent }, payload)
  const move: BranchMove = { below: [], collection: slug, documents: [], id, starts, versions: [] }
  // In a collection without parents nothing sits below a document, so there is no branch to read.
  const parentField = getParentFieldName(slug, payload)
  if (parentField === undefined) return move
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
  // own. A row that hangs from a document outside the branch gets no write of its own and no check of
  // where it lands, but the statements find the rows below by their ancestors, so they still put the
  // new start in its path where it has the old one, and the new ancestors in its ancestors.
  const parents = new Map<string, ParentPathAndAncestors | null>([[String(id), parent]])
  // The path and ancestors a row gets below its parent's new ones, with what they are built from, or
  // nothing for a row that hangs from a document outside the branch.
  const buildPathAndAncestorsBelow = (documentAndLatestVersion: DocumentAndLatestVersion, kind: 'document' | 'draft') => {
    const slugsAndParent = getSlugsAndParent(documentAndLatestVersion, kind, collection, payload)
    const { parentId, slugs } = slugsAndParent
    const newParent = parentId === null ? null : parents.get(String(parentId))
    return newParent === undefined
      ? undefined
      : { pathAndAncestors: buildPathAndAncestors(slugs, newParent, collection, payload), slugsAndParent }
  }
  // What the move does to a row that stores these, with what it built for the row, or nothing where
  // the row stores what it built and the statements leave it so. A write of its own also gives a row
  // the parent its ancestors hang from, and the statements change a parent only where it is the moved
  // document, so they serve only a row whose parent agrees with its ancestors.
  const buildRowMove = (
    row: Omit<StoredDocument, 'id'>,
    storedPathAndAncestors: PathAndAncestors,
    builtBelow: Omit<RowMove, 'needsOwnWrite'>
  ): RowMove | undefined => {
    const replacedPathAndAncestors = buildReplacedPathAndAncestors(storedPathAndAncestors, id, starts)
    const statementsBuildIt = hasSamePathAndAncestors(builtBelow.pathAndAncestors, replacedPathAndAncestors)
    if (statementsBuildIt && hasSamePathAndAncestors(builtBelow.pathAndAncestors, storedPathAndAncestors)) return
    const parentAgrees = hasParentOfAncestors(row, storedPathAndAncestors.ancestors, parentField)
    return { ...builtBelow, needsOwnWrite: !statementsBuildIt || !parentAgrees }
  }
  const getDepth = ({ ancestors }: StoredDocument) => ancestors?.length ?? 0
  for (const document of below.sort((upper, lower) => getDepth(upper) - getDepth(lower))) {
    const builtBelow = buildPathAndAncestorsBelow({ document, version: versions.get(String(document.id)) }, 'document')
    if (!builtBelow) continue
    parents.set(String(document.id), { ...builtBelow.pathAndAncestors, id: document.id })
    const storedPathAndAncestors = getStoredPathAndAncestors(document, slug, payload)
    const rowMove = buildRowMove(document, storedPathAndAncestors, builtBelow)
    if (rowMove) move.documents.push({ ...rowMove, document, storedPaths: storedPathAndAncestors.paths })
  }
  for (const version of versions.values()) {
    const builtBelow = buildPathAndAncestorsBelow({ document: { ...version.version, id: version.parent }, version }, 'draft')
    const storedPathAndAncestors = getStoredPathAndAncestors(version.version, slug, payload)
    const rowMove = builtBelow && buildRowMove(version.version, storedPathAndAncestors, builtBelow)
    if (rowMove) move.versions.push({ ...rowMove, version })
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
 * Stores a branch move: first the statements, which write only the start of the path, the ancestors
 * and on a lift the parent of each row they find, so a save below that lands while a big branch moves
 * keeps the rest; then, top-down, each row that needs a write of its own, the documents first and then
 * the latest versions, each read again right before its write: a document with its latest version,
 * and a latest version found again, since a save may have made a newer one.
 *
 * - A row that is gone is skipped, and so is one whose slugs or parent are no longer the ones its
 *   path and ancestors were built from: the save that changed them gave the document a path in its
 *   own hooks, and a write here would undo that save. Such a row keeps what the statements wrote, and
 *   the rows written by themselves below it are skipped too, since the move built their paths from
 *   its old ones and its save gave them theirs.
 * - Every other row is written as it is now, with the path and ancestors the move built: a document's
 *   row with ifUnchanged, so a save between the read and the write is kept, and the row is read and
 *   decided again as many times as a save comes first.
 *
 * This narrows what two requests at once can do to each other, and closes none of it. A save of a
 * latest version between its read here and its write is written over, and a row deleted in the moment
 * the move writes it comes back: see setDraftPathAndAncestors and setPathAndAncestors. A save that
 * changed a row's slugs or parent before the move wrote that row's parent built its path from the
 * parent's old one, so the skipped row is left below where its parent was, until a run of
 * backfillPaths. A row the statements serve is never read again, so a row written by itself below one
 * that a save renamed meanwhile gets a path built from the move's first read of the renamed one.
 */
export async function moveBranch(move: BranchMove, req: PayloadRequest) {
  const { collection } = move
  if ([...move.documents, ...move.versions].some(({ needsOwnWrite }) => !needsOwnWrite)) await setPathAndAncestorsBelow(move, req)
  const { config } = req.payload.collections[collection as CollectionSlug]
  // The statements may have lifted a row written by itself already, so a row is built from the same
  // parent whether it holds the deleted document or the parent it is lifted to.
  const { liftedTo } = move.starts
  const withLiftedParent = ({ parentId, slugs }: SlugsAndParent): SlugsAndParent => ({
    parentId: liftedTo !== undefined && String(parentId) === String(move.id) ? liftedTo : parentId,
    slugs
  })
  const hasSlugsAndParentOfMove = (
    documentAndLatestVersion: DocumentAndLatestVersion,
    kind: 'document' | 'draft',
    slugsAndParentOfMove: SlugsAndParent
  ) => {
    const slugsAndParentNow = getSlugsAndParent(documentAndLatestVersion, kind, config, req.payload)
    return hasSameSlugsAndParent(withLiftedParent(slugsAndParentNow), withLiftedParent(slugsAndParentOfMove))
  }
  // Writes a document's row as it is now, with the path and ancestors the move built, and says
  // whether it did: not for a row that is gone or no longer built from the same slugs and parent.
  const findAndSetPathAndAncestors = async (
    id: Id,
    pathAndAncestors: PathAndAncestors,
    slugsAndParent: SlugsAndParent
  ): Promise<boolean> => {
    const documentAndLatestVersion = await findDocumentAndLatestVersion(config, id, req)
    if (!documentAndLatestVersion || !hasSlugsAndParentOfMove(documentAndLatestVersion, 'document', slugsAndParent)) return false
    const { document } = documentAndLatestVersion
    const wasWritten = await setPathAndAncestors(collection, document, pathAndAncestors, req, { ifUnchanged: true })
    return wasWritten || (await findAndSetPathAndAncestors(id, pathAndAncestors, slugsAndParent))
  }
  const skippedDocumentIds = new Set<string>()
  const isBelowSkippedDocument = ({ ancestors }: PathAndAncestors) =>
    ancestors.some((ancestor) => skippedDocumentIds.has(String(ancestor)))
  const needsOwnWrite = (rowMove: RowMove) => rowMove.needsOwnWrite
  for (const { document, pathAndAncestors, slugsAndParent } of move.documents.filter(needsOwnWrite)) {
    const wasWritten =
      !isBelowSkippedDocument(pathAndAncestors) &&
      (await findAndSetPathAndAncestors(document.id, pathAndAncestors, slugsAndParent))
    if (!wasWritten) skippedDocumentIds.add(String(document.id))
  }
  for (const { pathAndAncestors, slugsAndParent, version: versionOfMove } of move.versions.filter(needsOwnWrite)) {
    if (isBelowSkippedDocument(pathAndAncestors)) continue
    const latestVersion = await findLatestVersion(collection, versionOfMove.parent, req)
    if (!latestVersion) continue
    const documentAndLatestVersion = { document: { ...latestVersion.version, id: latestVersion.parent }, version: latestVersion }
    if (hasSlugsAndParentOfMove(documentAndLatestVersion, 'draft', slugsAndParent)) {
      await setDraftPathAndAncestors(collection, latestVersion, pathAndAncestors, req)
    }
  }
}
