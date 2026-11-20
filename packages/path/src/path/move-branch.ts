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

type BranchMoveRequest = {
  collection: CollectionConfig
  // The document whose branch moves, or the deleted document whose branch is lifted.
  id: Id
  // What the documents right below hang from now: the document with its new path and ancestors, for
  // a lift its parent, or nothing at the top level.
  parent: ParentPathAndAncestors | null
  // Where the document was before the move, which the paths below start with, or nothing where that
  // isn't known.
  pathAndAncestorsBefore: PathAndAncestors | undefined
  req: PayloadRequest
}

// A row that the move or its statements change, with the path and ancestors the move built for it,
// the slugs and parent they are built from, the paths it stores, and whether the statements can't
// give it those the move built, so it needs a write of its own.
type RowMove = {
  needsOwnWrite: boolean
  pathAndAncestors: PathAndAncestors
  slugsAndParent: SlugsAndParent
  storedPaths: Paths
}

// The rows a move changes, top-down, and every document the branch holds below its first, which the
// id names, with what the statements write into the rows below it.
export type BranchMove = {
  below: StoredDocument[]
  collection: string
  documents: (RowMove & { document: StoredDocument })[]
  id: Id
  // Whether findBranchMove held the branch until the request ends, so the save may have waited for a
  // move above it.
  isBranchHeld: boolean
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
  for (const { locale, newStart, oldStart } of starts.paths) {
    const path = paths[locale]
    if (path?.startsWith(`${oldStart}/`)) replacedPaths[locale] = `${newStart}${path.slice(oldStart.length)}`
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
export async function findBranchMove({
  collection,
  id,
  parent,
  pathAndAncestorsBefore,
  req
}: BranchMoveRequest): Promise<BranchMove> {
  const { payload } = req
  const { slug } = collection
  const starts = getStartsBelow(slug, { id, parent, pathAndAncestorsBefore }, payload)
  const move: BranchMove = { below: [], collection: slug, documents: [], id, isBranchHeld: false, starts, versions: [] }
  // In a collection without parents nothing sits below a document, so there is no branch to read.
  const parentField = getParentFieldName(slug, payload)
  if (parentField === undefined) return move
  move.isBranchHeld = await lockBranch(slug, id, req)
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
  // own.
  const parents = new Map<string, ParentPathAndAncestors | null>([[String(id), parent]])
  // What the move does to a row, with the path and ancestors it gets and what they are built from, or
  // nothing where the row stores them already and the statements leave it so. A row gets them below
  // its parent's new ones, by the rule.
  // - A row that hangs from a document outside the branch stores the moved document among its
  //   ancestors all the same, so the statements find it. It gets what they make of what it stores, so
  //   where it lands is checked and onPathsChanged hears of it, and it is never written by itself,
  //   which would give it another parent than the one it holds.
  // - A write of its own also gives a row the parent its ancestors hang from, and the statements
  //   change a parent only where it is the moved document, so they serve only a row whose parent
  //   agrees with its ancestors.
  const buildRowMove = (documentAndLatestVersion: DocumentAndLatestVersion, kind: 'document' | 'draft'): RowMove | undefined => {
    // The row itself: the document's, or for a draft the latest version's, under its document's id.
    const { document: row } = documentAndLatestVersion
    const slugsAndParent = getSlugsAndParent(documentAndLatestVersion, kind, collection, payload)
    const { parentId, slugs } = slugsAndParent
    const newParent = parentId === null ? null : parents.get(String(parentId))
    const storedPathAndAncestors = getStoredPathAndAncestors(row, slug, payload)
    const replacedPathAndAncestors = buildReplacedPathAndAncestors(storedPathAndAncestors, id, starts)
    const hangsOutsideBranch = newParent === undefined
    const pathAndAncestors = hangsOutsideBranch
      ? replacedPathAndAncestors
      : buildPathAndAncestors(slugs, newParent, collection, payload)
    if (kind === 'document') parents.set(String(row.id), { ...pathAndAncestors, id: row.id })
    const statementsBuildPathAndAncestors = hasSamePathAndAncestors(pathAndAncestors, replacedPathAndAncestors)
    if (statementsBuildPathAndAncestors && hasSamePathAndAncestors(pathAndAncestors, storedPathAndAncestors)) return
    const parentAgrees = hasParentOfAncestors(row, storedPathAndAncestors.ancestors, parentField)
    const needsOwnWrite = !hangsOutsideBranch && (!statementsBuildPathAndAncestors || !parentAgrees)
    return { needsOwnWrite, pathAndAncestors, slugsAndParent, storedPaths: storedPathAndAncestors.paths }
  }
  const getDepth = ({ ancestors }: StoredDocument) => ancestors?.length ?? 0
  for (const document of below.sort((upper, lower) => getDepth(upper) - getDepth(lower))) {
    const rowMove = buildRowMove({ document, version: versions.get(String(document.id)) }, 'document')
    if (rowMove) move.documents.push({ ...rowMove, document })
  }
  for (const version of versions.values()) {
    const rowMove = buildRowMove({ document: { ...version.version, id: version.parent }, version }, 'draft')
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
  if ([...move.documents, ...move.versions].some(({ needsOwnWrite }) => !needsOwnWrite)) {
    await setPathAndAncestorsBelow(collection, move.id, move.starts, req)
  }
  const { config } = req.payload.collections[collection as CollectionSlug]
  // The statements may have lifted a row written by itself already, so a row is built from the same
  // parent whether it holds the deleted document or the parent it is lifted to.
  const { liftParentId } = move.starts
  const withLiftedParent = ({ parentId, slugs }: SlugsAndParent): SlugsAndParent => ({
    parentId: liftParentId !== undefined && String(parentId) === String(move.id) ? liftParentId : parentId,
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
