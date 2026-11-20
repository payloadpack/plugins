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

// Runs in afterChange because only then is it known what Payload wrote: a draft goes into the latest
// version only, and a publish in one locale decides which locales the document holds. And the
// documents below need writes of their own, which a hook before the write can't make. Every check
// runs before the first write.
export const setPathAfterChange: CollectionAfterChangeHook = async ({ collection, doc, operation, req }) => {
  const { payload } = req
  const { slug } = collection
  try {
    const { saved } = getPathContext(req)
    const key = documentKey(slug, doc.id)
    const before = operation === 'create' ? undefined : saved.get(key)
    saved.delete(key)

    const stored = await findDocumentAndLatestVersion(collection, doc.id, req)
    if (!stored) return doc
    const { document, version } = stored
    const built = await findParentAndBuildPathAndAncestors(stored, 'document', collection, req)
    const builtDraft = version ? await findParentAndBuildPathAndAncestors(stored, 'draft', collection, req) : built
    const storedInDocument = getStoredPathAndAncestors(document, slug, payload)
    const storedInVersion = version && getStoredPathAndAncestors(version.version, slug, payload)

    // Only what Payload's write decided is checked here. A path the document was at before the write,
    // or that Payload's write carried, the hook before the write checked.
    checkPublishedPaths(collection, document, built, req)
    const newPaths = [
      ...getNewPaths(built, before, storedInDocument),
      ...(storedInVersion ? getNewPaths(builtDraft, storedInVersion) : [])
    ]
    await checkNewPaths(slug, doc.id, newPaths, req, THIS_PATH)
    // Other ones than before the write, whoever wrote them.
    const isElsewhere = operation === 'update' && !(before && hasSamePathAndAncestors(before, built))
    const branchMove = isElsewhere
      ? await findBranchMove({ collection, id: doc.id, parent: { ...built, id: doc.id }, req })
      : undefined
    if (branchMove) await checkBranchMove(branchMove, req)

    const changedPaths = getChangedPaths({ collection, pathAndAncestors: built, req, stored }, before)
    const wrote = await setDocumentAndDraftPathAndAncestors(slug, stored, { document: built, draft: builtDraft }, req)
    if (branchMove) await moveBranch(branchMove, req)

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
