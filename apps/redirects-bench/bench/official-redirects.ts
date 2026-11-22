import { redirectsPlugin as officialRedirectsPlugin } from '@payloadcms/plugin-redirects'
import type { Payload, TypeWithID } from 'payload'

// Payload's own redirects plugin would take the slug redirects, which this package's collection holds,
// so its collection lives beside ours under a slug of its own.
export const OFFICIAL_REDIRECTS_SLUG = 'official-redirects'

/** A redirect of Payload's own plugin, as its collection stores it and a find returns it. */
type OfficialRedirect = TypeWithID & {
  from: string
  to?: { reference?: unknown; type?: 'custom' | 'reference'; url?: null | string }
}

// As Payload's website template adds it, with the collections a reference can point to. Its own
// overrides only add a description to from and a hook that revalidates the cached list, which no
// lookup runs.
export const buildOfficialRedirectsPlugin = () =>
  officialRedirectsPlugin({ collections: ['pages'], overrides: { slug: OFFICIAL_REDIRECTS_SLUG } })

/**
 * Every redirect, as the website template's getRedirects reads them: one find at depth 1 with no
 * limit, without access control.
 */
export async function findAllOfficialRedirects(payload: Payload) {
  const { docs } = await payload.find({
    collection: OFFICIAL_REDIRECTS_SLUG,
    depth: 1,
    limit: 0,
    overrideAccess: true,
    pagination: false
  })
  return docs as unknown as OfficialRedirect[]
}

// The template's PayloadRedirects compares each redirect's from to the path, exactly as written.
export const pickOfficialRedirect = (redirects: OfficialRedirect[], path: string) =>
  redirects.find((redirect) => redirect.from === path)

/** What the template pays for a path when the list isn't cached: every redirect read, then the scan. */
export const findOfficialRedirect = async (payload: Payload, path: string) =>
  pickOfficialRedirect(await findAllOfficialRedirects(payload), path)

/**
 * What the template pays for a path when Next's unstable_cache holds the list: Next stores
 * JSON.stringify of the list and parses all of it on every read, then the scan runs.
 */
export const getCachedOfficialRedirect = (cachedList: string, path: string) =>
  pickOfficialRedirect(JSON.parse(cachedList) as OfficialRedirect[], path)

// One year, which unstable_cache stores as the revalidate of an entry given none, as the template gives.
const CACHE_ONE_YEAR_SECONDS = 31_536_000

/**
 * The size Next's incremental cache checks against its 2 MB limit: JSON.stringify of the whole entry
 * unstable_cache sets, whose body is the list already stringified, so each quote in it counts twice.
 * The entry is built as next/dist/server/web/spec-extension/unstable-cache.js builds it, and the
 * check is the one in next/dist/server/lib/incremental-cache/index.js.
 */
export const getNextCacheEntryLength = (cachedList: string) =>
  JSON.stringify({
    kind: 'FETCH',
    data: { headers: {}, body: cachedList, status: 200, url: '' },
    revalidate: CACHE_ONE_YEAR_SECONDS
  }).length

// Over this, Next's own cache handler refuses the entry, so every check reads every redirect again.
export const NEXT_CACHE_LIMIT = 2 * 1024 * 1024
