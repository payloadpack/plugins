import type { PayloadRequest } from 'payload'

import type { Id, LocalePath } from '../path/build-path-and-ancestors.js'
import { buildTakenPathError } from '../plugin/messages.js'
import { findTakenPath } from './find-taken-path.js'

/**
 * Refuses the paths of a document that another document is at, which the refusal names with where
 * it is: the path, or what an editor who is saving at that path reads instead.
 */
export async function checkTakenPaths(
  collection: string,
  id: Id | undefined,
  paths: LocalePath[],
  req: PayloadRequest,
  here?: string
) {
  const taken = await findTakenPath(paths, { collection, ids: id === undefined ? [] : [id] }, req)
  if (taken) throw buildTakenPathError(collection, taken, req, here)
}
