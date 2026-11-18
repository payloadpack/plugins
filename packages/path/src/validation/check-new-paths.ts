import type { PayloadRequest } from 'payload'

import { countBelow } from '../database/documents.js'
import { HOME_PAGE_PATH, type Id, type LocalePath, type PathAndAncestors } from '../path/build-path-and-ancestors.js'
import { buildFieldError, homePageBranchRefusal, REFUSAL_FIELD } from '../plugin/messages.js'
import { checkTakenPaths } from './check-taken-paths.js'
import { getReservedPathRefusal } from './get-reserved-path-refusal.js'

// A document's paths that are other ones than each of those given holds in that locale.
export const getNewPaths = (pathAndAncestors: PathAndAncestors, ...known: (PathAndAncestors | undefined)[]) =>
  Object.entries(pathAndAncestors.paths).filter(
    (entry): entry is LocalePath => entry[1] !== null && known.every((each) => each?.paths[entry[0]] !== entry[1])
  )

/**
 * Refuses the paths a document can't be at: one with a reserved segment, the home page's for a
 * document with others below it, and one another document is at, which the refusal names with where
 * it is: the path, or what an editor who is saving at that path reads instead.
 */
export async function checkNewPaths(slug: string, id: Id | undefined, paths: LocalePath[], req: PayloadRequest, here?: string) {
  for (const [locale, path] of paths) {
    const refusal = getReservedPathRefusal(path, req.payload)
    if (refusal) throw buildFieldError(slug, REFUSAL_FIELD, refusal, req, locale)
  }
  // The paths below the home page would start with /home/, which it doesn't answer.
  const becomesHomePage = id !== undefined && paths.some(([, path]) => path === HOME_PAGE_PATH)
  if (becomesHomePage && (await countBelow(slug, id, req)) > 0) {
    throw buildFieldError(slug, REFUSAL_FIELD, homePageBranchRefusal(slug, req), req)
  }
  await checkTakenPaths(slug, id, paths, req, here)
}
