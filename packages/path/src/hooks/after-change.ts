import type { CollectionAfterChangeHook } from 'payload'

import {
  findDocumentAndLatestVersion,
  findParentAndBuildPathAndAncestors,
  setDocumentAndDraftPathAndAncestors
} from '../database/versions.js'
import { getStoredPathAndAncestors, hasSamePathAndAncestors } from '../path/build-path-and-ancestors.js'
import { findBranchMove, moveBranch } from '../path/move-branch.js'
import { THIS_PATH } from '../plugin/messages.js'
import { isLocalized } from '../plugin/options.js'
import { getSaved } from '../utils/locales.js'
import { checkBranchMove } from '../validation/check-branch-move.js'
import { checkNewPaths, getNewPaths } from '../validation/check-new-paths.js'
import { checkPublishedPaths } from '../validation/check-published-paths.js'
import { freePaths } from '../validation/take-paths.js'
import { documentKey, getBulkOperation, getPathContext } from './context.js'
import { getChangedPaths, getChangedPathsBelow, reportChangedPaths } from './paths-change.js'

/**
 * Stores the path and ancestors a save gave its document, moves the documents below it, and tells
 * the site. It runs in Payload's afterChange because only then is it known what Payload wrote: a
 * draft goes into the latest version only, and a publish in one locale decides which locales the
 * document holds. And the documents below need writes of their own, which a hook before the write
 * can't make.
 *
 * It looks at what the database holds, in the steps below. Every check runs before the first write,
 * and the site hears which paths changed after the last.
 */
export const setPathAfterChange: CollectionAfterChangeHook = async ({ collection, doc, operation, req }) => {
  const { payload } = req
  const { slug } = collection
  try {
    // Where the document was before the write, which the hook before it kept.
    const { saved } = getPathContext(req)
    const key = documentKey(slug, doc.id)
    const before = operation === 'create' ? undefined : saved.get(key)
    saved.delete(key)

    // What Payload wrote, and the path and ancestors the one rule makes of it: the document's, and
    // the ones its latest draft would give it.
    const stored = await findDocumentAndLatestVersion(collection, doc.id, req)
    if (!stored) return doc
    const { document, version } = stored
    const built = await findParentAndBuildPathAndAncestors(stored, 'document', collection, req)
    const builtDraft = version ? await findParentAndBuildPathAndAncestors(stored, 'draft', collection, req) : built
    const storedInDocument = getStoredPathAndAncestors(document, slug, payload)
    const storedInVersion = version && getStoredPathAndAncestors(version.version, slug, payload)

    // The checks of what only Payload's write decided. A path is new where the document wasn't at it
    // before the write and Payload's write didn't carry it, which the hook before the write checked.
    // The same for a path of the draft's that the latest version doesn't store.
    checkPublishedPaths(collection, document, built, req)
    const newPaths = [
      ...getNewPaths(built, before, storedInDocument),
      ...(storedInVersion ? getNewPaths(builtDraft, storedInVersion) : [])
    ]
    await checkNewPaths(slug, doc.id, newPaths, req, THIS_PATH)
    // The document is elsewhere when its path or ancestors are other ones than before the write,
    // whoever wrote them.
    const isElsewhere = operation === 'update' && !(before && hasSamePathAndAncestors(before, built))
    const branchMove = isElsewhere
      ? await findBranchMove({ collection, id: doc.id, parent: { ...built, id: doc.id }, pathAndAncestorsBefore: before, req })
      : undefined
    if (branchMove) await checkBranchMove(branchMove, req)

    // The writes: the document and its latest version, where the row stores another path or other
    // ancestors than the ones built, and then the documents below.
    const changedPaths = getChangedPaths({ collection, pathAndAncestors: built, req, stored }, before)
    const wrote = await setDocumentAndDraftPathAndAncestors(slug, stored, { document: built, draft: builtDraft }, req)
    if (branchMove) await moveBranch(branchMove, req)

    // The site hears what changed: the document's own paths, then those of the documents below.
    await reportChangedPaths([...changedPaths, ...(branchMove ? getChangedPathsBelow(branchMove, payload) : [])], req)

    // Payload made the saved document before this hook wrote, so it gets the path the hook built.
    const { inData } = getSaved(req, isLocalized(slug, payload))
    const written = wrote.draft || (!version && wrote.document)
    return written ? { ...doc, path: inData(builtDraft.paths) ?? null } : doc
  } finally {
    // The database shows what a document of a bulk update took from here on, or it was refused.
    const bulkOperation = getBulkOperation(req, slug)
    if (bulkOperation) freePaths(bulkOperation.takenPaths, { collection: slug, id: doc.id })
  }
}
