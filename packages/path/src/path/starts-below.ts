import type { Payload } from 'payload'

import { getAncestorsBelow, getParentPaths, type Id } from './build-path-and-ancestors.js'
import type { BranchMoveRequest } from './move-branch.js'

// What the statements write into the rows below a moved document, each only where it changes: the
// start of their paths in each locale, before the move and after it, the ancestors that replace the
// ones up to and including the moved document, and on a lift the parent the rows right below are
// lifted to, which is null at the top level.
export type StartsBelow = {
  ancestors: Id[] | undefined
  liftedTo: Id | null | undefined
  paths: { from: string; locale: string; to: string }[]
}

/**
 * What the statements write below a moved document, from what the documents right below hang from
 * after the move: the document with its new path and ancestors, on a lift its parent, or the top
 * level. A path's start changes in each locale where the document has a path before the move and the
 * documents right below start with one after it, and they differ. The ancestors start with the
 * document's own and the document before the move, so a rename keeps them, a move keeps the document
 * after its new ones, and a lift leaves it out, which gives the documents right below another parent.
 */
export function getStartsBelow(
  collection: string,
  { from, id, parent }: Pick<BranchMoveRequest, 'from' | 'id' | 'parent'>,
  payload: Payload
): StartsBelow {
  if (!from) return { ancestors: undefined, liftedTo: undefined, paths: [] }
  const parentPaths = getParentPaths(parent, collection, payload)
  const paths = Object.entries(from.paths).flatMap(([locale, pathBefore]) => {
    const parentPath = parentPaths[locale]
    return typeof pathBefore === 'string' && typeof parentPath === 'string' && pathBefore !== parentPath
      ? [{ from: pathBefore, locale, to: parentPath }]
      : []
  })
  const ancestors = getAncestorsBelow(parent)
  const parentId = parent?.id ?? null
  return {
    ancestors: ancestors.join() === [...from.ancestors, id].join() ? undefined : ancestors,
    liftedTo: String(parentId) === String(id) ? undefined : parentId,
    paths
  }
}
