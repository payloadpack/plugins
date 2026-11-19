import type { PayloadRequest } from 'payload'

import { HOME_PAGE_PATH } from '../path/build-path-and-ancestors.js'
import { getLandings, type BranchMove } from '../path/move-branch.js'
import { becomesHomePageRefusal, buildFieldError, buildTakenPathError, REFUSAL_FIELD } from '../plugin/messages.js'
import { findTakenPath } from './find-taken-path.js'
import { getReservedPathRefusal } from './get-reserved-path-refusal.js'

/**
 * Refuses a move that would land a document of the branch on a path it can't be at: the home page's,
 * one with a reserved segment, and one a document outside the branch is at. The branch is the
 * documents below the one that moved, or was deleted.
 */
export async function checkBranchMove(move: BranchMove, req: PayloadRequest) {
  const { below, collection, id } = move
  const landings = getLandings(move)
  for (const { document, locale, path } of landings) {
    // A top-level document with the root slug answers /, which a lifted document would not have before.
    const refusal =
      path === HOME_PAGE_PATH
        ? becomesHomePageRefusal(collection, document, locale, req)
        : getReservedPathRefusal(path, req.payload)
    if (refusal) throw buildFieldError(collection, REFUSAL_FIELD, refusal, req, locale)
  }
  const taken = await findTakenPath(
    landings.map(({ locale, path }) => [locale, path]),
    { below, collection, ids: [id] },
    req
  )
  if (taken) throw buildTakenPathError(collection, taken, req)
}
