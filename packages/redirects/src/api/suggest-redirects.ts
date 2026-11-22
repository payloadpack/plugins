import { AsyncLocalStorage } from 'node:async_hooks'
import { APIError, type CollectionSlug, type Payload, type PayloadRequest } from 'payload'

import { FROM_FIELD_NAME, isFromTooLong } from '../fields/from.js'
import { MATCH_FIELD_NAME, SUGGESTED_MATCH, type Match } from '../fields/match.js'
import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { buildDocumentKey } from '../fields/target-document-key.js'
import { TO_FIELD_NAME, type StoredTarget, type TargetType } from '../fields/to.js'
import { TYPE_FIELD_NAME, type RedirectType } from '../fields/type.js'
import { getRedirectsConfig } from '../plugin/options.js'
import { buildComparedPath, buildPathAndPathsAbove } from '../redirect/path.js'

/** Where a site finds one document, before and now, as onPathsChanged of @payloadpack/path reports it. */
type ChangedPath = { collection: string; from: null | string; id: number | string; locale?: string; to: null | string }

/** What onPathsChanged of @payloadpack/path is given, which a site passes on whole. */
export type SuggestRedirectsArgs = { changedPaths: ChangedPath[]; payload: Payload; req: PayloadRequest }

// A document at a path it wasn't at before: published there, or moved there from another.
type Arrival = ChangedPath & { to: string }

type Move = Arrival & { from: string }

type StoredRedirect = {
  [FROM_FIELD_NAME]: string
  [STATUS_FIELD_NAME]: Status
  [TO_FIELD_NAME]?: StoredTarget
  id: number | string
}

const isArrival = (changed: ChangedPath): changed is Arrival => changed.to !== null && changed.from !== changed.to

const isMove = (arrival: Arrival): arrival is Move => arrival.from !== null

// SQLite binds at most 32,766 values in one statement, the tightest limit of the three databases, so
// a change of any size is read and deleted 1,000 values at a time.
const CHUNK_SIZE = 1_000

function buildChunks<Value>(values: Value[]) {
  const chunks: Value[][] = []
  for (let start = 0; start < values.length; start += CHUNK_SIZE) chunks.push(values.slice(start, start + CHUNK_SIZE))
  return chunks
}

// A locale's moves are compared with the same locale's, by the path each document moved from.
const buildLocalePathKey = (locale: string | undefined, path: string) => JSON.stringify([locale ?? null, path])

// The move of the nearest document above that a document moved with, whose suggestion covers it, or
// null for a document published or at the top of a moved branch. One that moved elsewhere, as a
// document lifted twice in one bulk delete may, tops a branch of its own.
function getAncestorMove({ from, locale, to }: Arrival, movesByFrom: Map<string, Move>) {
  if (from === null) return null
  for (const pathAbove of buildPathAndPathsAbove(from).slice(1)) {
    const aboveMove = movesByFrom.get(buildLocalePathKey(locale, pathAbove))
    if (aboveMove && `${aboveMove.to}${from.slice(pathAbove.length)}` === to) return aboveMove
  }
  return null
}

// The moves a suggestion may come from, of the collections a redirect can send visitors to, one per
// path, by the From it is stored as: a collection with one path in every locale reports a move once per
// locale. A From too long for the index on from is refused, which would fail the save that moved the
// document, so such an old path gets none, nor do the paths below it.
const buildMovesByOldPath = (arrivals: Arrival[], targetCollections: Set<string>) =>
  new Map(
    arrivals
      .filter((arrival): arrival is Move => isMove(arrival) && targetCollections.has(arrival.collection))
      .map((move) => [buildComparedPath(move.from), move] as const)
      .filter(([oldPath]) => !isFromTooLong(oldPath))
  )

// Payload deletes every document of a bulk delete before any of them reports, so a delete can report
// a document lifted out of the page it deleted that the same delete took away too. It holds no path,
// and a redirect can't send visitors to it: Postgres and SQLite refuse a relationship to a row that is
// gone. A page a site doesn't show, such as a draft, reports no delete of its own, only the documents
// it lifts, so every report of a move is read.
async function findStoredArrivals(payload: Payload, req: PayloadRequest, arrivals: Arrival[]) {
  const storedDocumentKeys = new Set<string>()
  for (const collection of new Set(arrivals.map((arrival) => arrival.collection))) {
    const ids = arrivals.filter((arrival) => arrival.collection === collection).map(({ id }) => id)
    for (const chunk of buildChunks(ids)) {
      const { docs } = await payload.find({
        collection: collection as CollectionSlug,
        depth: 0,
        overrideAccess: true,
        pagination: false,
        req,
        select: {},
        trash: true,
        where: { id: { in: chunk } }
      })
      for (const { id } of docs) storedDocumentKeys.add(buildDocumentKey(collection, id))
    }
  }
  return arrivals.filter(({ collection, id }) => storedDocumentKeys.has(buildDocumentKey(collection, id)))
}

// The redirects from the paths, each given as a From of a path is stored.
async function findRedirectsFrom(payload: Payload, req: PayloadRequest, slug: CollectionSlug, froms: string[]) {
  const redirects: StoredRedirect[] = []
  for (const chunk of buildChunks([...new Set(froms)])) {
    const { docs } = await payload.find({
      collection: slug,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      select: { [FROM_FIELD_NAME]: true, [STATUS_FIELD_NAME]: true, [TO_FIELD_NAME]: true },
      where: { [FROM_FIELD_NAME]: { in: chunk } }
    })
    redirects.push(...(docs as unknown as StoredRedirect[]))
  }
  return redirects
}

// By the relationship, which a database drops with the document it names, and never by the stored
// document key, which outlives it: SQLite can give a new document the id of one deleted, and a
// redirect an editor keeps to the old one would then read as one to the new.
const sendsToDocument = ({ to }: StoredRedirect, { collection, id }: Arrival) =>
  to?.type === 'document' &&
  to.document?.relationTo !== undefined &&
  buildDocumentKey(to.document.relationTo, to.document.value) === buildDocumentKey(collection, id)

// The calls on one request, whose last settles once the last one begun has ended. On the request object
// itself, which the copy of it Payload gives each document of some bulk updates reads through to.
const SUGGESTING = Symbol('payloadpackRedirectsSuggesting')

type Suggesting = { last: Promise<void> }

type SuggestingRequest = PayloadRequest & { [SUGGESTING]?: Suggesting }

// The calls of the request whose call is running, in the code that call runs, the hooks of its own
// writes included.
const runningCalls = new AsyncLocalStorage<Suggesting>()

/**
 * For onPathsChanged of @payloadpack/path: each moved branch gets a suggestion, a redirect from the
 * old path of the document at its top, and every path below it, to that document, which answers nobody
 * until someone says yes. Where a redirect an editor keeps, or another document of the change, is at
 * that old path, none is suggested from it, and each document right below that moved with it gets one
 * of its own by the same rules. At the path a document moved to or was published at go the
 * suggestions, since a document holds that path now, and any redirect to that document, which would
 * send that path and every path below it to itself. Written through the save's req, so they roll back
 * with a failed save.
 */
export function suggestRedirects(args: SuggestRedirectsArgs): Promise<void> {
  // Payload runs the hooks of a bulk delete or a bulk update all at once on one request, and its
  // orderable puts a new redirect after the last one stored, so the calls on one request suggest one
  // after another, each after the last one's suggestions. One that fails fails only its own caller. A
  // call from inside a running one, such as from a site's hook on a suggestion it writes, would wait
  // for itself, so it runs at once.
  const req = args.req as SuggestingRequest
  const suggesting = (req[SUGGESTING] ??= { last: Promise.resolve() })
  if (runningCalls.getStore() === suggesting) return suggestForChangedPaths(args)
  const call = suggesting.last.then(() => runningCalls.run(suggesting, () => suggestForChangedPaths(args)))
  suggesting.last = call.catch(() => undefined)
  return call
}

async function suggestForChangedPaths({ changedPaths, payload, req }: SuggestRedirectsArgs) {
  const { collections, slug } = getRedirectsConfig(payload)
  const targetCollections = new Set<string>(collections)
  const reportedArrivals = changedPaths.filter(isArrival)
  const arrivals = reportedArrivals.some(isMove) ? await findStoredArrivals(payload, req, reportedArrivals) : reportedArrivals
  const movesByFrom = new Map(arrivals.filter(isMove).map((move) => [buildLocalePathKey(move.locale, move.from), move]))
  // The documents that moved with another, by that one's old path as a From stores it, and under null
  // the documents published or at the top of a moved branch.
  const arrivalsBelowByFrom = new Map<null | string, Arrival[]>()
  for (const arrival of arrivals) {
    const ancestorMove = getAncestorMove(arrival, movesByFrom)
    const ancestorFrom = ancestorMove && buildComparedPath(ancestorMove.from)
    const arrivalsBelow = arrivalsBelowByFrom.get(ancestorFrom) ?? []
    arrivalsBelow.push(arrival)
    arrivalsBelowByFrom.set(ancestorFrom, arrivalsBelow)
  }
  const topArrivals = arrivalsBelowByFrom.get(null) ?? []
  if (topArrivals.length === 0) return
  // Every path a document of the change is at now, which no suggestion can be from.
  const newPaths = new Set(arrivals.map(({ to }) => buildComparedPath(to)))
  let movesToDecide = buildMovesByOldPath(topArrivals, targetCollections)
  const topNewPaths = topArrivals.map(({ to }) => buildComparedPath(to))
  const redirectsByFrom = new Map(
    (await findRedirectsFrom(payload, req, slug, [...topNewPaths, ...movesToDecide.keys()])).map((redirect) => [
      redirect.from,
      redirect
    ])
  )
  // Every redirect that goes is deleted before any suggestion is written, so a change that moves one
  // document to the path another left, such as two pages that swap paths, meets none on the unique from.
  const deletedIds = new Set<number | string>()
  for (const arrival of topArrivals) {
    const atNewPath = redirectsByFrom.get(buildComparedPath(arrival.to))
    if (atNewPath && (atNewPath.status === 'suggested' || sendsToDocument(atNewPath, arrival))) deletedIds.add(atNewPath.id)
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
    movesToDecide = buildMovesByOldPath(
      keptOldPaths.flatMap((oldPath) => arrivalsBelowByFrom.get(oldPath) ?? []),
      targetCollections
    )
    for (const redirect of await findRedirectsFrom(payload, req, slug, [...movesToDecide.keys()])) {
      redirectsByFrom.set(redirect.from, redirect)
    }
  }
  for (const chunk of buildChunks([...deletedIds])) {
    const { errors } = await payload.delete({
      collection: slug,
      depth: 0,
      overrideAccess: true,
      req,
      where: { id: { in: chunk } }
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
