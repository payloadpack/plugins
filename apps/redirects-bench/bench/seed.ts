import { REDIRECTS_SLUG } from '@payloadpack/redirects'
import type { Payload, TypeWithID } from 'payload'
import { generateNKeysBetween } from 'payload/shared'

import { AREAS } from '../src/viewed-paths.ts'
import { OFFICIAL_REDIRECTS_SLUG } from './official-redirects.ts'

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

type SeededRegex = { fixedStart: string; from: string; url: string }

type StoredRedirect = TypeWithID & { _order: string; lookupPath: null | string; targetDocumentKey: null | string }

const buildPagePath = (page: number) => `/page-${page}`

// The old path of redirect number <index>: from 2 to 4 segments, in one of the site's sections.
function buildOldPath(index: number) {
  const parts = Array.from({ length: index % 3 }, (_, part) => `/part-${part + 1}`).join('')
  return `/area-${index % AREAS}/old-${index}${parts}`
}

// Redirect number <index>, as moves and editors write them: from 2 to 4 segments, one in ten below
// the one before it, as a move of a page below a page that moved before writes, so from 2 to 5 in
// all. Most are what a move writes: from a path and every path below it, to a page.
function buildSeededRedirect(index: number, previous: SeededRedirect | undefined): SeededRedirect {
  const isNested = index % 10 === 9 && previous !== undefined
  const from = isNested ? `${previous.from}/moved-${index}` : buildOldPath(index)
  const match = index % 10 === 5 ? 'exact' : 'below'
  return index % 5 === 4 ? { from, match, url: `/new-section-${index}` } : { from, match, page: (index * 7_919) % PAGES }
}

// The app imports the package only by its published exports, so the fixed start is set by how the
// regex is built, and saveRegex proves it on the first one.
function buildSeededRegex(index: number): SeededRegex {
  const section = Math.floor(index / 2)
  return index % 2 === 0
    ? { fixedStart: `/legacy-${section}`, from: `^/legacy-${section}/(\\d{4})/(.+)$`, url: `/archive-${section}/$1/$2` }
    : { fixedStart: `/legacy-${section}`, from: `^/legacy-${section}/(.+)/feed$`, url: `/archive-${section}/$1` }
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

// The document key a redirect to a page keeps on its own row, as the package builds it, which
// proveStoredFields checks against one Payload saves.
const buildTargetDocumentKey = (pageId: number | string) => JSON.stringify(['pages', String(pageId)])

// Through Payload, whose hooks set the document key and the lookup path, the From of a redirect from a
// path, on a redirect the seed then deletes, so the redirects written straight to the database carry
// what a save would store.
async function proveStoredFields(payload: Payload, pageId: number | string) {
  const savedRedirect = await payload.create({
    collection: REDIRECTS_SLUG,
    data: { from: '/document-key-proof', to: { document: { relationTo: 'pages', value: pageId }, type: 'document' } },
    overrideAccess: true
  })
  const storedRedirect = await payload.db.findOne<StoredRedirect>({
    collection: REDIRECTS_SLUG,
    where: { id: { equals: savedRedirect.id } }
  })
  await payload.delete({ collection: REDIRECTS_SLUG, id: savedRedirect.id, overrideAccess: true })
  if (storedRedirect?.lookupPath !== '/document-key-proof') {
    throw new Error(`Payload stored /document-key-proof at the lookup path ${String(storedRedirect?.lookupPath)}`)
  }
  if (storedRedirect?.targetDocumentKey !== buildTargetDocumentKey(pageId)) {
    throw new Error(
      `Payload stored the document key ${String(storedRedirect?.targetDocumentKey)}, not ${buildTargetDocumentKey(pageId)}`
    )
  }
}

// The fields every redirect has, which payload.db.create, running no hooks, doesn't fill in.
const buildRedirectDefaults = (date: string) => ({ createdAt: date, status: 'on', type: 'permanent', updatedAt: date })

// Through Payload, whose hooks compute the lookup path, a regex's fixed start, and the order.
async function saveRegex(payload: Payload, { fixedStart, from, url }: SeededRegex) {
  const savedRegex = await payload.create({
    collection: REDIRECTS_SLUG,
    data: { from, match: 'regex', to: { type: 'url', url } },
    overrideAccess: true
  })
  const storedRegex = await payload.db.findOne<StoredRedirect>({
    collection: REDIRECTS_SLUG,
    where: { id: { equals: savedRegex.id } }
  })
  if (storedRegex?.lookupPath !== fixedStart) {
    throw new Error(
      `Payload stored ${from} at the lookup path ${String(storedRegex?.lookupPath)}, not its fixed start ${fixedStart}`
    )
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

  await proveStoredFields(payload, pageIds[0]!)
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
          lookupPath: from,
          targetDocumentKey: page === undefined ? null : buildTargetDocumentKey(pageIds[page]!),
          to:
            page === undefined
              ? { type: 'url', url }
              : { document: { relationTo: 'pages', value: pageIds[page] }, type: 'document' }
        }))
      )
      redirects.push(...newRedirects)
      const newRegexes = Array.from({ length: count - regexCount }, (_, offset) => buildSeededRegex(regexCount + offset))
      await writeRedirects(
        newRegexes.map(({ fixedStart, from, url }) => ({
          from,
          lookupPath: fixedStart,
          match: 'regex',
          targetDocumentKey: null,
          to: { type: 'url', url }
        }))
      )
      regexCount = count
    },
    buildPagePath
  }
}

export async function addRegexesWithoutFixedStart(payload: Payload) {
  for (const [index, from] of REGEXES_WITHOUT_FIXED_START.entries()) {
    await saveRegex(payload, { fixedStart: '/', from, url: `/moved-${index}` })
  }
}

// The field names a stored document holds, and those of each object in it, such as a target's.
const listStoredFields = (document: Record<string, unknown>): string[] =>
  Object.entries(document)
    .filter(([name]) => name !== 'id')
    .flatMap(([name, value]) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? [name, ...listStoredFields(value as Record<string, unknown>).map((field) => `${name}.${field}`)]
        : [name]
    )
    .sort()

// A row written straight to the database must store the fields a save through Payload stores.
async function proveSameFields(payload: Payload, collection: string, savedFrom: string, writtenFrom: string) {
  const [saved, written] = await Promise.all(
    [savedFrom, writtenFrom].map((from) =>
      payload.db.findOne<Record<string, unknown> & TypeWithID>({ collection, where: { from: { equals: from } } })
    )
  )
  const [savedFields, writtenFields] = [saved, written].map((document) => listStoredFields(document ?? {}).join(', '))
  if (savedFields !== writtenFields) {
    throw new Error(`${collection} stores ${savedFields} through Payload, but the seed wrote ${writtenFields}`)
  }
}

/**
 * The same redirects in this package's collection and in the collection of Payload's own plugin, each
 * from an exact path to a URL. A URL target leaves the website template's find at depth 1 nothing to
 * populate, which is the case most favourable to Payload's plugin. The first of each is saved through
 * Payload, and the rest go in by payload.db.create, as the speed bench seeds, in the shape Payload
 * writes them.
 */
export function createComparisonSeeder(payload: Payload) {
  let seeded = 0
  let lastOrder: string | undefined
  return {
    growTo: async (count: number) => {
      const redirects = Array.from({ length: count - seeded }, (_, offset) => ({
        from: buildOldPath(seeded + offset),
        url: `/new-section-${seeded + offset}`
      }))
      if (seeded === 0) {
        const [{ from, url }] = redirects.splice(0, 1) as [{ from: string; url: string }]
        await payload.create({
          collection: OFFICIAL_REDIRECTS_SLUG,
          data: { from, to: { type: 'custom', url } },
          overrideAccess: true
        })
        await payload.create({
          collection: REDIRECTS_SLUG,
          data: { from, match: 'exact', to: { type: 'url', url } },
          overrideAccess: true
        })
        const storedRedirect = await payload.db.findOne<StoredRedirect>({
          collection: REDIRECTS_SLUG,
          where: { from: { equals: from } }
        })
        if (storedRedirect?.lookupPath !== from || storedRedirect.targetDocumentKey !== null) {
          throw new Error(
            `Payload stored ${from} at the lookup path ${String(storedRedirect?.lookupPath)} with the document key ${String(storedRedirect?.targetDocumentKey)}`
          )
        }
        lastOrder = storedRedirect._order
      }
      const orders: string[] = generateNKeysBetween(lastOrder, null, redirects.length)
      lastOrder = orders.at(-1) ?? lastOrder
      const date = new Date().toISOString()
      await writeInBatches(
        redirects.map((redirect, index) => ({ ...redirect, _order: orders[index]! })),
        ({ _order, from, url }) =>
          Promise.all([
            payload.db.create({
              collection: OFFICIAL_REDIRECTS_SLUG,
              data: { createdAt: date, from, to: { type: 'custom', url }, updatedAt: date }
            }),
            payload.db.create({
              collection: REDIRECTS_SLUG,
              data: {
                ...buildRedirectDefaults(date),
                _order,
                from,
                lookupPath: from,
                match: 'exact',
                targetDocumentKey: null,
                to: { type: 'url', url }
              }
            })
          ])
      )
      if (seeded === 0) {
        await proveSameFields(payload, OFFICIAL_REDIRECTS_SLUG, buildOldPath(0), buildOldPath(1))
        await proveSameFields(payload, REDIRECTS_SLUG, buildOldPath(0), buildOldPath(1))
      }
      seeded = count
    }
  }
}
