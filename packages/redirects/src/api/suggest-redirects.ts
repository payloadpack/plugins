import { APIError, type CollectionSlug, type Payload, type PayloadRequest } from 'payload'

import { FROM_FIELD_NAME } from '../fields/from.js'
import { MATCH_FIELD_NAME, SUGGESTED_MATCH, type Match } from '../fields/match.js'
import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { TO_FIELD_NAME, type StoredTarget, type TargetType } from '../fields/to.js'
import { TYPE_FIELD_NAME, type RedirectType } from '../fields/type.js'
import { getRedirectsConfig } from '../plugin/options.js'
import { buildComparedPath, buildPathAndPathsAbove } from '../redirect/path.js'

/** Where a site finds one document, before and now, as onPathsChanged of @payloadpack/path reports it. */
type ChangedPath = { collection: string; from: null | string; id: number | string; locale?: string; to: null | string }

/** What onPathsChanged of @payloadpack/path is given, which a site passes on whole. */
export type SuggestRedirectsArgs = { changedPaths: ChangedPath[]; payload: Payload; req: PayloadRequest }

type Move = ChangedPath & { from: string; to: string }

type StoredRedirect = {
  [FROM_FIELD_NAME]: string
  [STATUS_FIELD_NAME]: Status
  [TO_FIELD_NAME]?: StoredTarget
  id: number | string
}

const isMove = (changed: ChangedPath): changed is Move =>
  changed.from !== null && changed.to !== null && changed.from !== changed.to

// A locale's moves are compared with the same locale's, by the path each document moved from.
const buildLocalePathKey = (locale: string | undefined, path: string) => JSON.stringify([locale ?? null, path])

// The move of the nearest document above that a document moved with, whose suggestion covers it, or
// null for the document at the top of a moved branch. One that moved elsewhere, as a document lifted
// twice in one bulk delete may, tops a branch of its own.
function getAncestorMove({ from, locale, to }: Move, movesByFrom: Map<string, Move>) {
  for (const pathAbove of buildPathAndPathsAbove(from).slice(1)) {
    const aboveMove = movesByFrom.get(buildLocalePathKey(locale, pathAbove))
    if (aboveMove && `${aboveMove.to}${from.slice(pathAbove.length)}` === to) return aboveMove
  }
  return null
}

// One suggestion per path, by the From it is stored as: a collection with one path in every locale
// reports a move once per locale.
const buildMovesByOldPath = (moves: Move[]) => new Map(moves.map((move) => [buildComparedPath(move.from), move]))

const buildDocumentKey = (collection: string, id: unknown) => JSON.stringify([collection, String(id)])

// Payload deletes every document of a bulk delete before any of them reports, so a delete can report
// a document lifted out of the page it deleted that the same delete took away too. A redirect can't
// send visitors to it: Postgres and SQLite refuse a relationship to a row that is gone.
async function findStoredMoves(payload: Payload, req: PayloadRequest, moves: Move[]) {
  const storedDocumentKeys = new Set<string>()
  for (const collection of new Set(moves.map((move) => move.collection))) {
    const { docs } = await payload.find({
      collection: collection as CollectionSlug,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      select: {},
      trash: true,
      where: { id: { in: moves.filter((move) => move.collection === collection).map(({ id }) => id) } }
    })
    for (const { id } of docs) storedDocumentKeys.add(buildDocumentKey(collection, id))
  }
  return moves.filter(({ collection, id }) => storedDocumentKeys.has(buildDocumentKey(collection, id)))
}

// The redirects from the paths, each given as a From of a path is stored.
async function findRedirectsFrom(payload: Payload, req: PayloadRequest, slug: CollectionSlug, froms: string[]) {
  if (froms.length === 0) return []
  const { docs } = await payload.find({
    collection: slug,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: { [FROM_FIELD_NAME]: true, [STATUS_FIELD_NAME]: true, [TO_FIELD_NAME]: true },
    where: { [FROM_FIELD_NAME]: { in: [...new Set(froms)] } }
  })
  return docs as unknown as StoredRedirect[]
}

const sendsToMovedDocument = ({ to }: StoredRedirect, { collection, id }: Move) =>
  to?.type === 'document' &&
  to.document?.relationTo !== undefined &&
  buildDocumentKey(to.document.relationTo, to.document.value) === buildDocumentKey(collection, id)

/**
 * For onPathsChanged of @payloadpack/path: each moved branch gets a suggestion, a redirect from the
 * old path of the document at its top, and every path below it, to that document, which answers nobody
 * until someone says yes. Where a redirect an editor keeps, or another document of the change, is at
 * that old path, none is suggested from it, and each document right below that moved with it gets one
 * of its own by the same rules. At the new path go the suggestions, since a document holds that path
 * now, and any redirect to the moved document, which would send that path and every path below it to
 * itself. Written through the save's req, so they roll back with a failed save.
 */
export async function suggestRedirects({ changedPaths, payload, req }: SuggestRedirectsArgs) {
  const { collections, slug } = getRedirectsConfig(payload)
  const targetCollections = new Set<string>(collections)
  const reportedMoves = changedPaths.filter(isMove).filter(({ collection }) => targetCollections.has(collection))
  const reportsDelete = changedPaths.some(({ from, to }) => from !== null && to === null)
  const moves = reportsDelete ? await findStoredMoves(payload, req, reportedMoves) : reportedMoves
  const movesByFrom = new Map(moves.map((move) => [buildLocalePathKey(move.locale, move.from), move]))
  // The moves of the documents that moved with another, by that one's old path as a From stores it,
  // and under null the moves of the documents at the top of a moved branch.
  const movesBelowByFrom = new Map<null | string, Move[]>()
  for (const move of moves) {
    const ancestorMove = getAncestorMove(move, movesByFrom)
    const ancestorFrom = ancestorMove && buildComparedPath(ancestorMove.from)
    const movesBelow = movesBelowByFrom.get(ancestorFrom) ?? []
    movesBelow.push(move)
    movesBelowByFrom.set(ancestorFrom, movesBelow)
  }
  const branchTops = movesBelowByFrom.get(null) ?? []
  if (branchTops.length === 0) return
  // Every path a document of the change is at now, which no suggestion can be from.
  const newPaths = new Set(moves.map(({ to }) => buildComparedPath(to)))
  let movesToDecide = buildMovesByOldPath(branchTops)
  const branchTopNewPaths = branchTops.map(({ to }) => buildComparedPath(to))
  const redirectsByFrom = new Map(
    (await findRedirectsFrom(payload, req, slug, [...branchTopNewPaths, ...movesToDecide.keys()])).map((redirect) => [
      redirect.from,
      redirect
    ])
  )
  // Every redirect that goes is deleted before any suggestion is written, so a change that moves one
  // document to the path another left, such as two pages that swap paths, meets none on the unique from.
  const deletedIds = new Set<number | string>()
  for (const move of branchTops) {
    const atNewPath = redirectsByFrom.get(buildComparedPath(move.to))
    if (atNewPath && (atNewPath.status === 'suggested' || sendsToMovedDocument(atNewPath, move))) deletedIds.add(atNewPath.id)
  }
  const movesToSuggest: Move[] = []
  while (movesToDecide.size > 0) {
    // The old paths that get no suggestion, whose documents right below that moved with them get one each.
    const keptOldPaths: string[] = []
    for (const [oldPath, move] of movesToDecide) {
      const atOldPath = redirectsByFrom.get(oldPath)
      // Another document of the change is at the old path now, or a redirect that is on or off, an
      // editor's, stands there.
      if (newPaths.has(oldPath) || (atOldPath && atOldPath.status !== 'suggested')) {
        keptOldPaths.push(oldPath)
        continue
      }
      // An earlier suggestion gives way to this one.
      if (atOldPath) deletedIds.add(atOldPath.id)
      movesToSuggest.push(move)
    }
    movesToDecide = buildMovesByOldPath(keptOldPaths.flatMap((oldPath) => movesBelowByFrom.get(oldPath) ?? []))
    for (const redirect of await findRedirectsFrom(payload, req, slug, [...movesToDecide.keys()])) {
      redirectsByFrom.set(redirect.from, redirect)
    }
  }
  if (deletedIds.size > 0) {
    const { errors } = await payload.delete({
      collection: slug,
      depth: 0,
      overrideAccess: true,
      req,
      where: { id: { in: [...deletedIds] } }
    })
    // A bulk delete reports what it couldn't delete instead of throwing, and the move can't go on as if
    // it were gone. Payload's own REST API answers such a delete with 400 too.
    if (errors[0]) throw new APIError(errors[0].message, 400, null, errors[0].isPublic)
  }
  for (const { collection, from, id } of movesToSuggest) {
    const data = {
      // As it is compared above, which the From field cleans to itself: the path as a visitor asks for
      // it, so a ? or # in it stays part of the path.
      [FROM_FIELD_NAME]: buildComparedPath(from),
      // Every path is below the home page's, which has no document below it.
      [MATCH_FIELD_NAME]: from === '/' ? ('exact' satisfies Match) : SUGGESTED_MATCH,
      [STATUS_FIELD_NAME]: 'suggested' satisfies Status,
      [TO_FIELD_NAME]: { document: { relationTo: collection, value: id }, type: 'document' satisfies TargetType },
      [TYPE_FIELD_NAME]: 'permanent' satisfies RedirectType
    }
    await payload.create({ collection: slug, data: data as never, depth: 0, overrideAccess: true, req })
  }
}
