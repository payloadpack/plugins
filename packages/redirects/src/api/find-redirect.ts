import type { CollectionSlug, Payload, PayloadRequest, RequestContext, Where } from 'payload'

import { FROM_FIELD_NAME } from '../fields/from.js'
import { MATCH_FIELD_NAME, type Match } from '../fields/match.js'
import { REGEX_PATH_FIELD_NAME } from '../fields/regex-path.js'
import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { TO_FIELD_NAME, type StoredTarget, type TargetType } from '../fields/to.js'
import { TYPE_FIELD_NAME, type RedirectType } from '../fields/type.js'
import { WINS_OVER_DOCUMENT_FIELD_NAME } from '../fields/wins-over-document.js'
import { HAS_DOCUMENT_MISSING_ERROR } from '../plugin/messages.js'
import { findTargetDocument, getRedirectsConfig, type RedirectsConfig } from '../plugin/options.js'
import { ORDER_FIELD_NAME } from '../plugin/redirects-collection.js'
import { buildDestination, type DestinationParts } from '../redirect/destination.js'
import {
  buildComparedPath,
  buildLookedUpPath,
  buildPathAndPathsAbove,
  buildPathBelow,
  encodePath,
  buildSitePath,
  SITE_ORIGIN
} from '../redirect/path.js'
import { matchRegex } from '../redirect/regex.js'
import { buildQueryString, buildSearchParams, buildTrackingSearchParams, type SearchParams } from '../redirect/query-string.js'

export type FoundRedirect = {
  /**
   * Where a visitor is sent, as a Location header carries it, with the visitor's query string but for
   * the parameters the redirect matched.
   */
  destination: string
  /**
   * Whether the redirect matched the visitor's query string. Such a redirect wins over a page at the
   * path, and without winOverDocuments any other loses to it.
   */
  matchedQueryString: boolean
  /** Whether the redirect is permanent (308) or temporary (307). */
  permanent: boolean
  /** Whether the destination is a document's path or a URL an editor wrote, such as to prefix a language. */
  to: { type: TargetType }
}

/**
 * What findRedirect resolves to: the redirect found, or null. An object, so a later field can join
 * it without breaking a site.
 */
export type FindRedirectResult = { foundRedirect: FoundRedirect | null }

type HasDocument = (path: string) => boolean | Promise<boolean>

export type FindRedirectArgs = {
  /**
   * Whether a document holds a path, by the site's own rules. With it, a redirect that lands on a
   * path no document holds is looked up again, so a visitor takes one hop through a chain. Without it,
   * the first redirect is the answer, unless winOverDocuments is 'always', which follows a chain
   * without asking it. Required with winOverDocuments 'perRedirect', where it also says whether a
   * document at the path asked for wins.
   */
  hasDocument?: HasDocument
  /** With localization, the locale a document target is read in, whose path it sends visitors to. */
  locale?: string
  /**
   * The path a visitor asked for, decoded, with a slash first. A slash at its end is dropped, as a
   * From's is, so a site with Next's trailingSlash finds the same redirects.
   */
  path: string
  payload: Payload
  /**
   * The visitor's query string, such as request.nextUrl.searchParams in a proxy or a page's
   * searchParams. With it, a redirect from an exact path and a query string can answer, and the
   * destination keeps the visitor's parameters but for the ones the redirect matched.
   */
  searchParams?: SearchParams
  /** Passed on to every read, so the site's own hooks see it, such as to tag what it caches. */
  context?: RequestContext
  /**
   * Passed on to every read. The lookup reads as the request's user, so pass a visitor's request: a
   * signed-in user may read a target visitors can't.
   */
  req?: PayloadRequest
}

type ReadOptions = Pick<FindRedirectArgs, 'context' | 'locale' | 'payload' | 'req'>

type Candidate = {
  [FROM_FIELD_NAME]: string
  [MATCH_FIELD_NAME]: Match
  [TO_FIELD_NAME]?: StoredTarget
  [TYPE_FIELD_NAME]?: RedirectType
  // Only with winOverDocuments 'perRedirect', and missing on a redirect stored before it.
  [WINS_OVER_DOCUMENT_FIELD_NAME]?: boolean | null
}

// A found redirect, and whether its destination is its document target's own path, which that
// document holds.
type Step = FoundRedirect & { landsOnDocument: boolean }

type Try = { candidate: Candidate; matchedQueryString: boolean; parts: DestinationParts }

// No site or old link has a longer path, and each character is a step for every regex.
const LONGEST_REDIRECTED_PATH = 2_048

// No site has a path this deep, and each segment adds a value to the lookup, so no lookup reads more
// than 33 paths: these and /.
const MOST_REDIRECTED_SEGMENTS = 32

// Far more than editors' moves chain, and short enough that a chain gone wrong stops fast.
const MOST_PATHS_FOLLOWED = 10

const countSegments = (path: string) => path.split('/').length - 1

// A document visitors can't read, such as an unpublished one, one in the trash or one gone, sends
// nobody, and so does one buildDocumentPath builds no path on this site for.
async function findTarget(to: Candidate['to'], { context, locale, payload, req }: ReadOptions, config: RedirectsConfig) {
  if (to?.type === 'url') return to.url ?? null
  if (to?.type !== 'document') return null
  const { relationTo, value: id } = to.document ?? {}
  const collection = relationTo as CollectionSlug
  if (!config.collections.includes(collection) || (typeof id !== 'string' && typeof id !== 'number')) return null
  const document = await findTargetDocument({ collection, context, id, locale, payload, req }, config)
  if (!document) return null
  const documentPath = await config.buildDocumentPath({ collection, document, locale, payload, req })
  return documentPath === null ? null : encodePath(documentPath)
}

async function findStep({ candidate, matchedQueryString, parts }: Try, options: ReadOptions, config: RedirectsConfig) {
  const { to, type } = candidate
  const target = await findTarget(to, options, config)
  const destination = target && buildDestination(target, parts)
  if (!to?.type || !destination) return null
  return {
    destination,
    landsOnDocument: to.type === 'document' && !parts.pathBelow,
    matchedQueryString,
    permanent: type === 'permanent',
    to: { type: to.type }
  } satisfies Step
}

const winsOverDocument = ({ candidate, matchedQueryString }: Try) =>
  matchedQueryString || candidate[WINS_OVER_DOCUMENT_FIELD_NAME] === true

/**
 * One query on two indexes finds the redirects from the path and query string, from the path or a
 * path above it, and the regexes whose fixed start is one of those paths. A redirect from the path
 * and query string comes first, then the deepest redirect from a path, then the regexes in the order
 * editors sorted them. Each try is built when the one before it sent nobody, so a regex runs only
 * when no redirect from the path and query string or from a path answers.
 */
async function* findTries(
  path: string,
  searchParams: URLSearchParams,
  options: ReadOptions,
  config: RedirectsConfig
): AsyncGenerator<Try> {
  if (path.length > LONGEST_REDIRECTED_PATH || countSegments(path) > MOST_REDIRECTED_SEGMENTS) return
  const { slug, trackingParameters, winOverDocuments } = config
  // A From of a path is stored as buildComparedPath says, and a regex and its fixed start as written.
  const paths = buildPathAndPathsAbove(path)
  const comparedPaths = paths.map(buildComparedPath)
  const queryString = buildQueryString(searchParams, trackingParameters)
  const queryFrom = queryString ? `${comparedPaths[0]}?${queryString}` : null
  // The lookup asks for redirects that are on itself, so a signed-in user's request, which may read
  // every redirect, never follows one that is off or suggested.
  const where: Where = {
    and: [
      {
        or: [
          { [FROM_FIELD_NAME]: { in: queryFrom ? [queryFrom, ...comparedPaths] : comparedPaths } },
          { [REGEX_PATH_FIELD_NAME]: { in: [...new Set([...paths, '/'])] } }
        ]
      },
      { [STATUS_FIELD_NAME]: { equals: 'on' satisfies Status } }
    ]
  }
  const { docs } = await options.payload.find({
    collection: slug,
    context: options.context,
    depth: 0,
    locale: options.locale,
    overrideAccess: false,
    pagination: false,
    req: options.req,
    select: {
      [FROM_FIELD_NAME]: true,
      [MATCH_FIELD_NAME]: true,
      [TO_FIELD_NAME]: true,
      [TYPE_FIELD_NAME]: true,
      ...(winOverDocuments === 'perRedirect' ? { [WINS_OVER_DOCUMENT_FIELD_NAME]: true } : {})
    },
    sort: ORDER_FIELD_NAME,
    where
  })
  const candidates = docs as unknown as Candidate[]
  // Only Exact path holds a query string, though a regex can be written as the same text. The
  // parameters it matched leave the destination, and the tracking parameters stay.
  for (const candidate of candidates.filter(({ from, match }) => match === 'exact' && from === queryFrom)) {
    yield {
      candidate,
      matchedQueryString: true,
      parts: { searchParams: buildTrackingSearchParams(searchParams, trackingParameters) }
    }
  }
  const coveringRedirects = candidates
    .filter(({ from, match }) => match === 'below' || (match === 'exact' && from === comparedPaths[0]))
    .sort((first, second) => countSegments(second.from) - countSegments(first.from))
  for (const candidate of coveringRedirects) {
    const pathBelow = buildPathBelow(path, candidate.from)
    // A page's path is lowercase, and a URL takes the rest of the path as the visitor typed it.
    yield {
      candidate,
      matchedQueryString: false,
      parts: { pathBelow: candidate.to?.type === 'document' ? pathBelow.toLowerCase() : pathBelow, searchParams }
    }
  }
  for (const candidate of candidates.filter(({ match }) => match === 'regex')) {
    const captures = matchRegex(candidate.from, path)
    if (captures) yield { candidate, matchedQueryString: false, parts: { captures, searchParams } }
  }
}

/**
 * The redirect that answers a path: the first try whose target gives a destination, so only the
 * redirect that wins reads its document target, and one that sends nobody gives way to the next. So
 * any number of redirects and regexes costs one lookup, and one read more for a document. With
 * hasDocument, a try that can't win over a document is taken only where none holds the path, which
 * is asked once, when the first such try comes before any that answers, and never about a path that
 * is a document target's own.
 */
async function findRedirectStep(
  path: string,
  searchParams: URLSearchParams,
  options: ReadOptions,
  config: RedirectsConfig,
  hasDocument: HasDocument | undefined,
  landsOnDocument: boolean
) {
  // Not known until asked, so it starts undefined rather than false.
  let documentHeld: boolean | undefined = landsOnDocument || undefined
  for await (const candidateTry of findTries(path, searchParams, options, config)) {
    if (hasDocument && !winsOverDocument(candidateTry)) {
      documentHeld ??= await hasDocument(path)
      if (documentHeld) continue
    }
    const step = await findStep(candidateTry, options, config)
    if (step) return step
  }
  return null
}

const buildResult = (step: null | Step): FindRedirectResult => {
  if (!step) return { foundRedirect: null }
  const { landsOnDocument: _, ...foundRedirect } = step
  return { foundRedirect }
}

// A path a chain asks for, with the query string it is asked with.
type PathAsked = { path: string; searchParams: URLSearchParams }

type FindStepAt = (pathAsked: PathAsked, landsOnDocument: boolean) => Promise<null | Step>

// Each step is asked as a visitor asks for the destination before it, with its query string. Null for
// a destination on another site.
function buildNextPathAsked({ destination }: Step): null | PathAsked {
  const path = buildSitePath(destination)
  return path === null ? null : { path, searchParams: new URL(destination, SITE_ORIGIN).searchParams }
}

// A chain comes back to a path it met only with the same query string: asked without it, a path can
// answer with another redirect, as /products does after a redirect from /products?id=5.
const buildPathAskedKey = ({ path, searchParams }: PathAsked) => JSON.stringify([path, searchParams.toString()])

// A browser that follows a Location without a fragment keeps the one it had, so a step whose
// destination has none keeps the chain's. Every # a visitor or a document fills in is encoded, so the
// first one starts the fragment.
function buildChainDestination(chainDestination: string, nextDestination: string) {
  const fragmentStart = chainDestination.indexOf('#')
  if (fragmentStart === -1 || nextDestination.includes('#')) return nextDestination
  return `${nextDestination}${chainDestination.slice(fragmentStart)}`
}

const joinSteps = (chain: Step, nextStep: Step): Step => ({
  ...nextStep,
  destination: buildChainDestination(chain.destination, nextStep.destination),
  matchedQueryString: chain.matchedQueryString,
  permanent: chain.permanent && nextStep.permanent
})

// Without winOverDocuments, a chain ends at a destination a document holds. A document holds its own
// path, so a destination that is one needs no asking. The redirects moves write can send a path round
// in a circle, such as a parent renamed, a new page at its old path and a child moved below that one.
async function followChainToDocument(pathAsked: PathAsked, firstStep: Step, hasDocument: HasDocument, findStepAt: FindStepAt) {
  const pathsMet = new Set([buildPathAskedKey(pathAsked)])
  let chain = firstStep
  for (;;) {
    const nextPathAsked = chain.landsOnDocument ? null : buildNextPathAsked(chain)
    if (nextPathAsked === null || (await hasDocument(nextPathAsked.path))) return chain
    const nextPathKey = buildPathAskedKey(nextPathAsked)
    if (pathsMet.has(nextPathKey) || pathsMet.size === MOST_PATHS_FOLLOWED) return null
    pathsMet.add(nextPathKey)
    const nextStep = await findStepAt(nextPathAsked, false)
    if (!nextStep) return chain
    chain = joinSteps(chain, nextStep)
  }
}

// With winOverDocuments, a redirect can win over the document at a destination, so every destination
// on this site is looked up, and a chain ends where no redirect answers, also at a path it met. It
// comes round in a circle only when a redirect sends visitors on from a path it met with the same
// query string, and one that would leave an 11th path answers none, as one does without
// winOverDocuments.
async function followChainOverDocuments(pathAsked: PathAsked, firstStep: Step, findStepAt: FindStepAt) {
  const pathsMet = new Set([buildPathAskedKey(pathAsked)])
  let chain = firstStep
  for (;;) {
    const nextPathAsked = buildNextPathAsked(chain)
    if (nextPathAsked === null) return chain
    const nextStep = await findStepAt(nextPathAsked, chain.landsOnDocument)
    if (!nextStep) return chain
    const nextPathKey = buildPathAskedKey(nextPathAsked)
    if (pathsMet.has(nextPathKey) || pathsMet.size === MOST_PATHS_FOLLOWED) return null
    pathsMet.add(nextPathKey)
    chain = joinSteps(chain, nextStep)
  }
}

/**
 * The redirect for a path, in { foundRedirect }, or null there: a redirect from the path and the
 * visitor's query string, then one from the path or from a path above it and every path below, the
 * deepest winning, then the first regex in the editors' order that matches. One whose target sends
 * nobody falls through to the next. A chain is followed to its end, permanent only if every step was,
 * and one that comes back to a path it met with the same query string, or passes 10 paths, gives null.
 *
 * Without winOverDocuments, a site asks only where no document holds the path, and findRedirect never
 * asks hasDocument about the path asked for: a site that also checks where a page may be, such as in a
 * proxy, lets the page win unless matchedQueryString. Only with hasDocument does it follow a chain,
 * while it lands on paths no document holds. With 'always', every redirect wins over a document, so it
 * never asks hasDocument and follows a chain through documents. With 'perRedirect', a redirect wins
 * over a document only when it matched the query string or an editor picked it, so hasDocument is
 * required, asked only when the best redirect at a path can't win by itself, and never about a
 * destination that is its document target's own path, which that document holds.
 */
export async function findRedirect({
  hasDocument,
  path,
  searchParams,
  ...options
}: FindRedirectArgs): Promise<FindRedirectResult> {
  const config = getRedirectsConfig(options.payload)
  const { winOverDocuments } = config
  if (winOverDocuments === 'perRedirect' && !hasDocument) throw new Error(HAS_DOCUMENT_MISSING_ERROR)
  // Only with 'perRedirect' does a document at a path stop a redirect there.
  const perRedirectHasDocument = winOverDocuments === 'perRedirect' ? hasDocument : undefined
  const findStepAt: FindStepAt = (pathAsked, landsOnDocument) =>
    findRedirectStep(pathAsked.path, pathAsked.searchParams, options, config, perRedirectHasDocument, landsOnDocument)
  const pathAsked = { path: buildLookedUpPath(path), searchParams: buildSearchParams(searchParams) }
  const firstStep = await findStepAt(pathAsked, false)
  if (!firstStep) return buildResult(null)
  if (winOverDocuments) return buildResult(await followChainOverDocuments(pathAsked, firstStep, findStepAt))
  if (!hasDocument) return buildResult(firstStep)
  return buildResult(await followChainToDocument(pathAsked, firstStep, hasDocument, findStepAt))
}
