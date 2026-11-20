import type { CollectionBeforeChangeHook, Payload } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { findDocumentById, findParentPathAndAncestors } from '../database/documents.js'
import {
  buildPathAndAncestors,
  getOwnSlugLocales,
  getStoredPathAndAncestors,
  idOf,
  type Id,
  type LocalePath,
  type PathAndAncestors
} from '../path/build-path-and-ancestors.js'
import { findSlugs } from '../path/find-slugs.js'
import { findBranchMove, getLandings } from '../path/move-branch.js'
import { THIS_PATH } from '../plugin/messages.js'
import { getParentFieldName, isLocalized } from '../plugin/options.js'
import { getSaved } from '../utils/locales.js'
import { getShownLocales, isInTrash } from '../utils/published-locales.js'
import { checkBranchMove } from '../validation/check-branch-move.js'
import { checkNewPaths, getNewPaths } from '../validation/check-new-paths.js'
import { checkParent } from '../validation/check-parent.js'
import { checkSlugs } from '../validation/check-slugs.js'
import { freePaths, takePaths } from '../validation/take-paths.js'
import { documentKey, getBulkOperation, getPathContext, takeDocumentWrite, type PathAndAncestorsBefore } from './context.js'

// Payload fills a field a save leaves out from the latest version, except in a restore. On MongoDB a
// restored version from before the document had a parent holds none, and Payload's write then leaves
// the document the parent it has, so the data says that the document keeps it.
const getParentId = (
  parentField: string | undefined,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined
) => (parentField === undefined ? null : idOf(data[parentField] === undefined ? originalDoc?.[parentField] : data[parentField]))

type SavedPaths = {
  checked: LocalePath[]
  // What a refusal calls a path of these: this path to an editor who is saving at it, and the path
  // itself for a document that leaves the trash, whose slug nobody is editing.
  here: string | undefined
  moved: LocalePath[]
  taken: LocalePath[]
}

function getSavedPaths(
  built: PathAndAncestors,
  before: PathAndAncestorsBefore | undefined,
  {
    collection,
    leavesTrash,
    payload,
    savedLocales,
    writesDocument
  }: { collection: string; leavesTrash: boolean; payload: Payload; savedLocales: string[]; writesDocument: boolean }
): SavedPaths {
  // A path the document itself is at already was checked when it got there. A document in the trash
  // takes no path, so one that a save takes out of it takes the paths it stores again.
  const savedIn = new Set(savedLocales)
  const newPaths = getNewPaths(built, before).filter(([pathLocale]) => savedIn.has(pathLocale))
  const takenAgain = leavesTrash && before ? getNewPaths(before) : []
  // A save moves the document now where Payload writes the document itself, and where a site doesn't
  // find the document, so that the document's own slug doesn't count there. A pending move takes
  // nothing.
  const ownSlugLocales = new Set(before ? getOwnSlugLocales(before.shownLocales, collection, payload) : [])
  const moved = newPaths.filter(([pathLocale]) => writesDocument || !ownSlugLocales.has(pathLocale))
  return {
    checked: [...takenAgain, ...newPaths],
    here: leavesTrash ? undefined : THIS_PATH,
    moved,
    taken: [...takenAgain, ...moved]
  }
}

// Runs in beforeChange because that is the last point where a refusal stops the write, and the only
// one where the path, the slug and the ancestors can go into the data Payload writes. Of that write it
// knows only whether Payload writes the document itself, and the hook after the write looks at the
// rest. It stores nothing, because Payload's dry-run validate runs this hook too.
export const checkPathBeforeChange: CollectionBeforeChangeHook = async ({ collection, data, operation, originalDoc, req }) => {
  const { payload } = req
  const { slug } = collection
  const localized = isLocalized(slug, payload)
  const { inData, savedLocales } = getSaved(req, localized)
  // A duplicate is created with its source as the original.
  const id: Id | undefined = operation === 'create' ? undefined : originalDoc?.id
  const publishes = !hasDraftsEnabled(collection) || data._status === 'published'

  // A draft without a slug has no path yet. A publish needs one in some locale: in the save, made from
  // the title, or stored in a locale a saved locale falls back to.
  const { fallbackSlugs, slugs } = await findSlugs({ collection, data, id, req })
  if (publishes) {
    checkSlugs(slug, [...savedLocales.map((savedLocale) => slugs[savedLocale]), ...fallbackSlugs], req)
  }

  const parentField = getParentFieldName(slug, payload)
  const parentId = getParentId(parentField, data, originalDoc)
  const parent = await findParentPathAndAncestors(slug, parentId, req)
  checkParent(slug, { id, parent, parentId }, req)
  const built = buildPathAndAncestors(slugs, parent, collection, payload)

  const document = id === undefined ? undefined : await findDocumentById(slug, id, req)
  const before: PathAndAncestorsBefore | undefined = document && {
    ...getStoredPathAndAncestors(document, slug, payload),
    shownLocales: getShownLocales(document, collection, payload)
  }
  const leavesTrash = document !== undefined && isInTrash(document) && data.deletedAt === null

  // A document of a bulk update, which a dry run and a document saved on its own are not.
  const bulkOperation = getBulkOperation(req, slug)
  const takes = operation === 'update' && document && bulkOperation && !bulkOperation.savedOnTheirOwn.has(String(document.id))

  const documentWrite = takes ? bulkOperation.documentWrite : id === undefined ? undefined : takeDocumentWrite(req, slug, id)
  const paths = getSavedPaths(built, before, {
    collection: slug,
    leavesTrash,
    payload,
    savedLocales,
    // A save no operation noted, such as a create or a dry run, is taken by its status.
    writesDocument: documentWrite === 'always' || (documentWrite !== 'never' && publishes)
  })

  // What a document of a bulk update takes is kept by that bulk update only, so a save that fails after
  // this hook can't leave a path taken for anything after it.
  const taking = takes ? { by: { collection: slug, id: document.id }, document, takenPaths: bulkOperation.takenPaths } : undefined
  try {
    if (taking) {
      const taken = paths.taken.map(([locale, path]) => ({ collection: slug, document: taking.document, locale, path }))
      takePaths(taking.takenPaths, taking.by, taken, req, paths.here)
    }
    await checkNewPaths(slug, id, paths.checked, req, paths.here)
    if (id !== undefined && before && paths.moved.length > 0) {
      const branchMove = await findBranchMove({
        collection,
        id,
        parent: { ancestors: built.ancestors, id, paths: { ...before.paths, ...Object.fromEntries(paths.moved) } },
        req
      })
      if (taking) takePaths(taking.takenPaths, taking.by, getLandings(branchMove), req)
      await checkBranchMove(branchMove, req)
    }
  } catch (error) {
    // A refused save takes nothing.
    if (taking) freePaths(taking.takenPaths, taking.by)
    throw error
  }

  // For the hook after the write.
  if (id !== undefined && before) getPathContext(req).saved.set(documentKey(slug, id), before)
  return {
    ...data,
    path: inData(built.paths) ?? null,
    slug: inData(slugs),
    ...(parentField === undefined
      ? {}
      : { ancestors: built.ancestors, ...(parentId === null ? {} : { [parentField]: parentId }) })
  }
}
