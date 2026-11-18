import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import { buildFieldError, describeTakenPath, REFUSAL_FIELD } from '../plugin/messages.js'
import { pathKey, type TakenPath } from './find-taken-path.js'

// The document being saved or deleted, which is never in its own way.
type By = { collection: string; id: Id }

/**
 * Where the saves and deletes of each request are about to put documents, by locale and path, from
 * before each asks the database until it has written. Kept by the request itself and gone with it,
 * and not in its context: Payload uses the context object a site passes as the request's own, and a
 * site may pass one object to many requests, which would hand each other what a failed save took.
 */
const takingOn = new WeakMap<PayloadRequest, Map<string, { by: By; taken: TakenPath }>>()

function getTaking(req: PayloadRequest) {
  const taking = takingOn.get(req) ?? new Map<string, { by: By; taken: TakenPath }>()
  takingOn.set(req, taking)
  return taking
}

const isSame = (one: By, other: By) => one.collection === other.collection && String(one.id) === String(other.id)

/**
 * Takes the paths a save or a delete is about to put documents at, on the request, and refuses one
 * that another save or delete of the same request took first. Payload runs the documents of a bulk
 * operation at once, so each asks the database before another has written, and the database shows
 * none of them in another's way. A save or a delete takes before it asks the database, and nothing
 * awaits between the look and the take, so of two that want one path the second is always refused.
 */
export function takePaths(by: By, paths: TakenPath[], req: PayloadRequest, here?: string) {
  const taking = getTaking(req)
  const taken = paths.flatMap(({ locale, path }) => {
    const other = taking.get(pathKey(locale, path))
    return other && !isSame(other.by, by) ? [other.taken] : []
  })
  // The locale of the request before another, as findTakenPath names it.
  const first = taken.find(({ locale }) => locale === req.locale) ?? taken[0]
  if (first) throw buildFieldError(by.collection, REFUSAL_FIELD, describeTakenPath(first, req, here), req, first.locale)
  for (const each of paths) taking.set(pathKey(each.locale, each.path), { by, taken: each })
}

// Frees what a save or a delete took, once it has written, when the database shows it, or was refused.
export function freePaths(by: By, req: PayloadRequest) {
  const taking = getTaking(req)
  for (const [path, taken] of taking) if (isSame(taken.by, by)) taking.delete(path)
}
