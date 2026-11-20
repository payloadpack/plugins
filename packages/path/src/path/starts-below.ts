import type { Payload } from 'payload'

import {
  getAncestorsBelow,
  getParentPaths,
  type Id,
  type ParentPathAndAncestors,
  type PathAndAncestors
} from './build-path-and-ancestors.js'

// What the statements write into the rows below a moved document, each only where it changes: in
// each locale the old start of their paths and the new one that replaces it, the ancestors that
// replace the ones up to and including the moved document, and on a lift the id of the parent the
// rows right below are lifted to, which is null at the top level.
export type StartsBelow = {
  ancestors: Id[] | undefined
  liftParentId: Id | null | undefined
  paths: { locale: string; newStart: string; oldStart: string }[]
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
  {
    id,
    parent,
    pathAndAncestorsBefore
  }: { id: Id; parent: ParentPathAndAncestors | null; pathAndAncestorsBefore: PathAndAncestors | undefined },
  payload: Payload
): StartsBelow {
  if (!pathAndAncestorsBefore) return { ancestors: undefined, liftParentId: undefined, paths: [] }
  const parentPaths = getParentPaths(parent, collection, payload)
  const paths = Object.entries(pathAndAncestorsBefore.paths).flatMap(([locale, pathBefore]) => {
    const parentPath = parentPaths[locale]
    return typeof pathBefore === 'string' && typeof parentPath === 'string' && pathBefore !== parentPath
      ? [{ locale, newStart: parentPath, oldStart: pathBefore }]
      : []
  })
  const ancestors = getAncestorsBelow(parent)
  const parentId = parent?.id ?? null
  return {
    ancestors: ancestors.join() === [...pathAndAncestorsBefore.ancestors, id].join() ? undefined : ancestors,
    liftParentId: String(parentId) === String(id) ? undefined : parentId,
    paths
  }
}
