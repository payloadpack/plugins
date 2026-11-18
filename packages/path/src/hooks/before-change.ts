import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { findDocumentById, findParentPathAndAncestors, type StoredDocument } from '../database/documents.js'
import {
  buildPathAndAncestors,
  getOwnSlugLocales,
  getStoredPathAndAncestors,
  idOf,
  type Id,
  type PathAndAncestors
} from '../path/build-path-and-ancestors.js'
import { findSlugs } from '../path/find-slugs.js'
import { findBranchMove, getLandings } from '../path/move-branch.js'
import { THIS_PATH } from '../plugin/messages.js'
import { getParentFieldName, isLocalized } from '../plugin/options.js'
import { getSaved } from '../utils/locales.js'
import { getShownLocales, isInTrash } from '../utils/published-locales.js'
import { checkBranchMove } from '../validation/check-branch-move.js'
import { checkNewPaths, getNewPaths, type LocalePath } from '../validation/check-new-paths.js'
import { checkParent } from '../validation/check-parent.js'
import { checkSlugs } from '../validation/check-slugs.js'
import { freePaths, takePaths } from '../validation/take-paths.js'
import { documentKey, getPathContext, type PathAndAncestorsBefore } from './context.js'

// The parent a save gives the document. Payload fills a field a save leaves out from the latest
// version, except in a restore. On MongoDB a restored version from before the document had a parent
// holds none, and Payload's write then leaves the document the parent it has, so the data says that
// the document keeps it.
const getParentId = (
  parentField: string | undefined,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined
) => (parentField === undefined ? null : idOf(data[parentField] === undefined ? originalDoc?.[parentField] : data[parentField]))

// The paths a save builds that count for its checks, each as a locale and a path.
type SavedPaths = {
  // The ones the save is checked for.
  checked: LocalePath[]
  // What a refusal calls a path of these: this path to an editor who is saving at it, and the path
  // itself for a document that leaves the trash, whose slug nobody is editing.
  here: string | undefined
  // The ones the document moves to with this save, which the documents below it follow.
  moved: LocalePath[]
  // The ones the document takes with this save.
  taken: LocalePath[]
}

function getSavedPaths(
  built: PathAndAncestors,
  { before, document }: { before: PathAndAncestorsBefore | undefined; document: StoredDocument | undefined },
  {
    collection,
    data,
    publishes,
    req
  }: { collection: CollectionConfig; data: Record<string, unknown>; publishes: boolean; req: PayloadRequest }
): SavedPaths {
  const { slug } = collection
  // A path the document itself is at already was checked when it got there. A document in the trash
  // takes no path, so one that a save takes out of it takes the paths it stores again.
  const savedIn = new Set(getSaved(req, isLocalized(slug, req.payload)).savedLocales)
  const newPaths = getNewPaths(built, before).filter(([pathLocale]) => savedIn.has(pathLocale))
  const leavesTrash = document !== undefined && isInTrash(document) && data.deletedAt === null
  const takenAgain = leavesTrash && before ? getNewPaths(before) : []
  // A save moves the document now where it publishes, and where a site doesn't find the document,
  // so that the document's own slug doesn't count there. A pending move takes nothing.
  const ownSlugLocales = new Set(before ? getOwnSlugLocales(before.shownLocales, slug, req.payload) : [])
  const moved = newPaths.filter(([pathLocale]) => publishes || !ownSlugLocales.has(pathLocale))
  return {
    checked: [...takenAgain, ...newPaths],
    here: leavesTrash ? undefined : THIS_PATH,
    moved,
    taken: [...takenAgain, ...moved]
  }
}

/**
 * Checks the path a save would give its document, and puts it in the data. It runs in Payload's
 * beforeChange because that is the last point where a refusal stops the write, and the only one
 * where the path, the slug and the ancestors can go into the data Payload writes: into the latest
 * version always, and into the document itself when Payload writes that. It predicts nothing of that
 * write. The hook after it looks.
 *
 * It refuses what the data itself shows, in this order: a missing slug, a parent the document can't
 * sit below, a path the document can't be at, and a landing of a document below it. It stores nothing,
 * because Payload's dry-run validate runs this hook too. A save of a stored document takes its paths
 * on the request before it asks the database, because Payload runs the documents of a bulk update at
 * once.
 */
export const checkPathBeforeChange: CollectionBeforeChangeHook = async ({ collection, data, operation, originalDoc, req }) => {
  const { payload } = req
  const { slug } = collection
  const localized = isLocalized(slug, payload)
  const { inData, savedLocales } = getSaved(req, localized)
  // A duplicate is created with its source as the original.
  const id: Id | undefined = operation === 'create' ? undefined : originalDoc?.id
  const publishes = !hasDraftsEnabled(collection) || data._status === 'published'

  // The slug. A draft without one has no path yet, and a stored document may have a localized slug
  // in another locale to fall back to, which only the hook after the write sees.
  const slugs = await findSlugs({ collection, data, id, req })
  const fallsBack = localized && hasDraftsEnabled(collection) && id !== undefined
  if (publishes && !fallsBack) {
    checkSlugs(
      slug,
      savedLocales.map((savedLocale) => slugs[savedLocale]),
      req
    )
  }

  // The parent, and the path and ancestors the slug and the parent make.
  const parentField = getParentFieldName(slug, payload)
  const parentId = getParentId(parentField, data, originalDoc)
  const parent = await findParentPathAndAncestors(slug, parentId, req)
  checkParent(slug, { id, parent, parentId }, req)
  const built = buildPathAndAncestors({ parentId, slugs }, parent, collection, payload)

  // Where the document is now, and which of the built paths it isn't at yet.
  const document = id === undefined ? undefined : await findDocumentById(slug, id, req)
  const before: PathAndAncestorsBefore | undefined = document && {
    ...getStoredPathAndAncestors(document, slug, payload),
    shownLocales: getShownLocales(document, collection, payload)
  }
  const paths = getSavedPaths(built, { before, document }, { collection, data, publishes, req })

  // The paths, and then where the documents below land: each taken on the request first, and then
  // checked against the database. Only a save of a stored document takes: a dry run writes nothing,
  // and a create has no id to take by, which no bulk operation needs.
  const taker = operation === 'update' ? document : undefined
  const by = taker && { collection: slug, id: taker.id }
  try {
    if (by) {
      const taken = paths.taken.map(([locale, path]) => ({ collection: slug, document: taker, locale, path }))
      takePaths(by, taken, req, paths.here)
    }
    await checkNewPaths(collection, id, paths.checked, req, paths.here)
    if (id !== undefined && before && paths.moved.length > 0) {
      const branchMove = await findBranchMove({
        collection,
        document: { ...data, id },
        parent: { ancestors: built.ancestors, id, paths: { ...before.paths, ...Object.fromEntries(paths.moved) } },
        req
      })
      if (by) takePaths(by, getLandings(branchMove), req)
      await checkBranchMove(branchMove, id, req)
    }
  } catch (error) {
    // A refused save takes nothing.
    if (by) freePaths(by, req)
    throw error
  }

  // For the hook after the write: where the document was. For Payload's write: the path.
  if (id !== undefined && before) getPathContext(req).saved.set(documentKey(slug, id), before)
  return {
    ...data,
    path: inData(built.paths) ?? null,
    slug: inData(slugs),
    // A collection without parents stores neither ancestors nor a parent.
    ...(parentField === undefined
      ? {}
      : { ancestors: built.ancestors, ...(parentId === null ? {} : { [parentField]: parentId }) })
  }
}
