import type { CollectionConfig, PayloadRequest } from 'payload'

import {
  BELOW_ITSELF_REFUSAL,
  buildFieldError,
  describeTakenPath,
  homePageBranchRefusal,
  homePageParentRefusal,
  MISSING_PARENT_REFUSAL,
  PARENT_WITHOUT_PATH_REFUSAL,
  REFUSAL_FIELD
} from '../plugin/messages.js'
import { findReservedPathRefusal, getParentRefusalField } from '../plugin/options.js'
import { countBelow } from './branch.js'
import { HOME_PAGE_PATH, type Id, type ParentPlace, type Place } from './place.js'
import { findTakenPath } from './taken-paths.js'

export type LocalePath = [locale: string, path: string]

// The paths of a place that are other ones than each of the places given holds in that locale.
export const findNewPaths = (place: Place, ...known: (Place | undefined)[]) =>
  Object.entries(place.paths).filter(
    (entry): entry is LocalePath => entry[1] !== null && known.every((knownPlace) => knownPlace?.paths[entry[0]] !== entry[1])
  )

/**
 * Refuses a parent a document can't sit below: one that doesn't exist, the document itself or one
 * below it, one without a path, and the home page.
 */
export function checkParent(
  collection: string,
  { id, parent, parentId }: { id: Id | undefined; parent: ParentPlace | null; parentId: Id | null },
  req: PayloadRequest
) {
  if (parentId === null) return
  const field = getParentRefusalField(collection, req.payload)
  if (!parent) throw buildFieldError(collection, field, MISSING_PARENT_REFUSAL, req)
  if (id !== undefined && [parent.id, ...parent.ancestors].some((above) => String(above) === String(id))) {
    throw buildFieldError(collection, field, BELOW_ITSELF_REFUSAL, req)
  }
  // A parent without a slug, or one stored before the plugin was added, has no path until it is saved.
  if (Object.values(parent.paths).every((parentPath) => parentPath === null)) {
    throw buildFieldError(collection, field, PARENT_WITHOUT_PATH_REFUSAL, req)
  }
  if (Object.values(parent.paths).includes(HOME_PAGE_PATH)) {
    throw buildFieldError(collection, field, homePageParentRefusal(collection, req), req)
  }
}

/**
 * Refuses the paths a document can't be at: one with a reserved segment, the home page's for a
 * document with others below it, and one another document is at, which the refusal names with where
 * it is: the path, or what an editor who is saving at that path reads instead.
 */
export async function checkNewPaths(
  collection: CollectionConfig,
  id: Id | undefined,
  paths: LocalePath[],
  req: PayloadRequest,
  here?: string
) {
  const { slug } = collection
  for (const [locale, path] of paths) {
    const refusal = findReservedPathRefusal(path, req.payload)
    if (refusal) throw buildFieldError(slug, REFUSAL_FIELD, refusal, req, locale)
  }
  // The paths below the home page would start with /home/, which it doesn't answer.
  const becomesHomePage = id !== undefined && paths.some(([, path]) => path === HOME_PAGE_PATH)
  if (becomesHomePage && (await countBelow(slug, id, req)) > 0) {
    throw buildFieldError(slug, REFUSAL_FIELD, homePageBranchRefusal(slug, req), req)
  }
  const taken = await findTakenPath(paths, { collection: slug, ids: id === undefined ? [] : [id] }, req)
  if (taken) throw buildFieldError(slug, REFUSAL_FIELD, describeTakenPath(taken, req, here), req, taken.locale)
}
