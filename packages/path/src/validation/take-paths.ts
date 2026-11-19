import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import { buildTakenPathError } from '../plugin/messages.js'
import { pathKey, type TakenPath } from './find-taken-path.js'

// The document being saved, which is never in its own way.
type By = { collection: string; id: Id }

/**
 * Where the documents of one bulk update are about to be put, by locale and path, from before each
 * asks the database until it has written. The bulk update keeps them, and they are gone with it.
 */
export type TakenPaths = Map<string, { by: By; taken: TakenPath }>

const isSame = (one: By, other: By) => one.collection === other.collection && String(one.id) === String(other.id)

/**
 * Takes the paths a document of a bulk update is about to be put at, and refuses one that another
 * document of the same bulk update took first. Payload runs the documents of a bulk update at once,
 * so each asks the database before another has written, and the database shows none of them in
 * another's way. A document takes before it asks the database, and nothing awaits between the look
 * and the take, so of two that want one path the second is always refused.
 */
export function takePaths(takenPaths: TakenPaths, by: By, paths: TakenPath[], req: PayloadRequest, here?: string) {
  const taken = paths.flatMap(({ locale, path }) => {
    const other = takenPaths.get(pathKey(locale, path))
    return other && !isSame(other.by, by) ? [other.taken] : []
  })
  // The locale of the request before another, as findTakenPath names it.
  const first = taken.find(({ locale }) => locale === req.locale) ?? taken[0]
  if (first) throw buildTakenPathError(by.collection, first, req, here)
  for (const each of paths) takenPaths.set(pathKey(each.locale, each.path), { by, taken: each })
}

// Frees what a document took, once it has written, when the database shows it, or was refused.
export function freePaths(takenPaths: TakenPaths, by: By) {
  for (const [path, taken] of takenPaths) if (isSame(taken.by, by)) takenPaths.delete(path)
}
