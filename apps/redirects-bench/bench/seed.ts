import { REDIRECTS_SLUG } from '@payloadpack/redirects'
import type { Payload, TypeWithID } from 'payload'
import { generateNKeysBetween } from 'payload/shared'

import { AREAS } from '../src/viewed-paths.ts'

// The pages the seeded redirects send visitors to, each at /page-<number>.
const PAGES = 1_000

const WRITTEN_AT_ONCE = 100

type SeededRedirect = {
  from: string
  match: 'below' | 'exact'
  // The page number a redirect to a page sends visitors to, or the URL of one to a URL.
  page?: number
  url?: string
}

type SeededRegex = { from: string; regexPath: string; url: string }

type StoredRedirect = TypeWithID & { _order: string; regexPath: null | string }

const buildPagePath = (page: number) => `/page-${page}`

// Redirect number <index>, as moves and editors write them: from 2 to 4 segments, one in ten below
// the one before it, as a move of a page below a page that moved before writes, so from 2 to 5 in
// all. Most are what a move writes: from a path and every path below it, to a page.
function buildSeededRedirect(index: number, previous: SeededRedirect | undefined): SeededRedirect {
  const isNested = index % 10 === 9 && previous !== undefined
  const depth = 2 + (index % 3)
  const parts = Array.from({ length: depth - 2 }, (_, part) => `/part-${part + 1}`).join('')
  const from = isNested ? `${previous.from}/moved-${index}` : `/area-${index % AREAS}/old-${index}${parts}`
  const match = index % 10 === 5 ? 'exact' : 'below'
  return index % 5 === 4 ? { from, match, url: `/new-section-${index}` } : { from, match, page: (index * 7_919) % PAGES }
}

// The app imports the package only by its published exports, so the fixed start is set by how the
// regex is built, and saveRegex proves it on the first one.
function buildSeededRegex(index: number): SeededRegex {
  const section = Math.floor(index / 2)
  return index % 2 === 0
    ? { from: `^/legacy-${section}/(\\d{4})/(.+)$`, regexPath: `/legacy-${section}`, url: `/archive-${section}/$1/$2` }
    : { from: `^/legacy-${section}/(.+)/feed$`, regexPath: `/legacy-${section}`, url: `/archive-${section}/$1` }
}

/**
 * Regexes without a fixed start, as sites carry over from an old platform. Their fixed start is /,
 * so a lookup reads and runs all of them for every path, and none matches a viewed page.
 */
export const REGEXES_WITHOUT_FIXED_START = [
  '/product-(\\d+)',
  '(.*)/print',
  '(.*)/amp',
  '(.*)/feed',
  '(.*)\\.php',
  '(.*)\\.aspx',
  '(.*)\\.html',
  '/index\\.(?:html|php)',
  '/item-(\\d+)\\.html',
  '/category-(.+)',
  '/tag-(.+)',
  '/author-(.+)',
  '/(\\d{4})-(\\d{2})-(\\d{2})-(.+)',
  '/p(\\d+)',
  '/node-(\\d+)',
  '(.*)/page-(\\d+)/comments',
  '(.*)/index',
  '/shop-(.+)',
  '(.*)/(?:AMP|amp)/(.*)',
  '(.*)/print-version'
]

// The fields every redirect has, which payload.db.create, running no hooks, doesn't fill in.
const buildRedirectDefaults = (date: string) => ({ createdAt: date, status: 'on', type: 'permanent', updatedAt: date })

// Through Payload, whose hooks compute the fixed start and the order.
async function saveRegex(payload: Payload, { from, regexPath, url }: SeededRegex) {
  const savedRegex = await payload.create({
    collection: REDIRECTS_SLUG,
    data: { from, match: 'regex', to: { type: 'url', url } },
    overrideAccess: true
  })
  const storedRegex = await payload.db.findOne<StoredRedirect>({
    collection: REDIRECTS_SLUG,
    where: { id: { equals: savedRegex.id } }
  })
  if (storedRegex?.regexPath !== regexPath) {
    throw new Error(`Payload stored ${from} with the fixed start ${String(storedRegex?.regexPath)}, not ${regexPath}`)
  }
  return storedRegex
}

async function writeInBatches<Row>(rows: Row[], write: (row: Row) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += WRITTEN_AT_ONCE) {
    await Promise.all(rows.slice(start, start + WRITTEN_AT_ONCE).map(write))
  }
}

/**
 * Rows go in by payload.db.create, in the shape Payload writes them, with no hooks run, so a page
 * target goes where the adapter keeps a relationship, such as redirects_rels on Postgres and SQLite.
 */
export async function createSeeder(payload: Payload) {
  const date = new Date().toISOString()
  const pageIds: (number | string)[] = []
  await writeInBatches(
    Array.from({ length: PAGES }, (_, page) => page),
    async (page) => {
      const { id } = await payload.db.create({
        collection: 'pages',
        data: { _status: 'published', createdAt: date, path: buildPagePath(page), title: `Page ${page}`, updatedAt: date }
      })
      pageIds[page] = id as number | string
    }
  )

  // Regex 0 is saved through Payload, so the rows written straight to the database continue its
  // order, and its fixed start proves theirs.
  let lastOrder = (await saveRegex(payload, buildSeededRegex(0)))._order
  const writeRedirects = async (rows: Record<string, unknown>[]) => {
    const orders: string[] = generateNKeysBetween(lastOrder, null, rows.length)
    lastOrder = orders.at(-1)!
    const redirectDefaults = buildRedirectDefaults(new Date().toISOString())
    await writeInBatches(
      rows.map((row, index) => ({ ...row, ...redirectDefaults, _order: orders[index] })),
      (data) => payload.db.create({ collection: REDIRECTS_SLUG, data })
    )
  }

  const redirects: SeededRedirect[] = []
  let regexCount = 1
  return {
    // The last redirect to a page seeded, below which a path answers 308 to the page with the rest of the path.
    get redirectToPage() {
      return [...redirects].reverse().find(({ match, page }) => match === 'below' && page !== undefined)!
    },
    growTo: async (count: number) => {
      const newRedirects: SeededRedirect[] = []
      while (redirects.length + newRedirects.length < count) {
        const index = redirects.length + newRedirects.length
        newRedirects.push(buildSeededRedirect(index, newRedirects.at(-1) ?? redirects.at(-1)))
      }
      await writeRedirects(
        newRedirects.map(({ from, match, page, url }) => ({
          from,
          match,
          regexPath: null,
          to:
            page === undefined
              ? { type: 'url', url }
              : { document: { relationTo: 'pages', value: pageIds[page] }, type: 'document' }
        }))
      )
      redirects.push(...newRedirects)
      const newRegexes = Array.from({ length: count - regexCount }, (_, offset) => buildSeededRegex(regexCount + offset))
      await writeRedirects(
        newRegexes.map(({ from, regexPath, url }) => ({ from, match: 'regex', regexPath, to: { type: 'url', url } }))
      )
      regexCount = count
    },
    buildPagePath
  }
}

export async function addRegexesWithoutFixedStart(payload: Payload) {
  for (const [index, from] of REGEXES_WITHOUT_FIXED_START.entries()) {
    await saveRegex(payload, { from, regexPath: '/', url: `/moved-${index}` })
  }
}
