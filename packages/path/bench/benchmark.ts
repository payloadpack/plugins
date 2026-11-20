import type { Payload } from 'payload'
import { afterAll, describe, it } from 'vitest'

import { findByPath, type PathPluginOptions } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { startPayload } from '../test/support/boot-payload.js'
import { create, readDocument, update } from '../test/support/documents.js'
import { LOCALES, SETUPS, type Setup } from '../test/support/setups.js'
import {
  comparedCollections,
  LOOKUP_METHODS,
  METHOD_COLLECTIONS,
  METHODS,
  NESTED_PAGES,
  PLAIN_PAGES,
  type Breadcrumb,
  type Method
} from './compared.js'
import {
  checkReadme,
  FULL_RUN_DOCUMENTS,
  logMemory,
  printAll,
  printSetup,
  writeReport,
  type Run,
  type SetupResults,
  type Timing
} from './report.js'

const MOVE_SIZE = 1_000
const DEEP_LEVELS = 10
const POST_TOPICS = 100
const LOOKUPS = 1_000
const SAVES = 200
// The pages seedPages lays out: 10 sections with 100 pages below them and 900 below those, the page
// that holds MOVE_SIZE pages, and the line of DEEP_LEVELS.
const PAGES = 10 + 100 + 900 + 1 + MOVE_SIZE + DEEP_LEVELS
// A post for each save the three save timings make, so no timing saves a post an earlier one changed.
const FEWEST_DOCUMENTS = PAGES + POST_TOPICS + 3 * SAVES

function readDocuments() {
  const given = process.env.BENCH_DOCUMENTS ?? ''
  if (given === '') return FULL_RUN_DOCUMENTS
  if (!/^\d+$/.test(given) || Number(given) < FEWEST_DOCUMENTS) {
    throw new Error(
      `BENCH_DOCUMENTS is ${given}, so set it to a whole number from ${FEWEST_DOCUMENTS} up, or leave it out for ${FULL_RUN_DOCUMENTS}.`
    )
  }
  return Number(given)
}

// BENCH_COMPARISON=off leaves the comparison and its copies out, for a run that only asks whether path
// got slower.
function readComparison() {
  const given = process.env.BENCH_COMPARISON ?? ''
  if (given !== '' && given !== 'off') throw new Error(`BENCH_COMPARISON is ${given}, so set it to off or leave it out.`)
  return given !== 'off'
}

const DOCUMENTS = readDocuments()
const COMPARISON = readComparison()
const RUN: Run = { compared: COMPARISON, documents: DOCUMENTS, lookupRuns: LOOKUPS }

const LOOKUP_PATHS = [
  { depth: 1, path: '/section-3' },
  { depth: 3, path: '/section-3/child-4/leaf-5' },
  { depth: DEEP_LEVELS, path: Array.from({ length: DEEP_LEVELS }, (_, index) => `/level-${index + 1}`).join('') }
]

const MOVED_METHODS = ['path', 'nested-docs'] as const satisfies readonly Method[]
type MovedMethod = (typeof MOVED_METHODS)[number]

const MOVES = [
  { below: 9, page: '/section-5/child-5', runs: 20 },
  { below: 100, page: '/section-6', runs: 20 },
  { below: MOVE_SIZE, page: '/moved', runs: 5 }
]

const BASE_PATHS = { [NESTED_PAGES]: '', pages: '', [PLAIN_PAGES]: '', posts: '/blog' }
const COLLECTIONS: PathPluginOptions['collections'] = ['pages', { basePath: BASE_PATHS.posts, slug: 'posts' }]

// SQLite writes one document at a time.
const SEED_CONCURRENCY = { mongodb: 16, postgres: 8, sqlite: 1 }

type SeededCollection = keyof typeof BASE_PATHS

type Seeded = { collection: SeededCollection; id: Id; paths: Record<string, string>; slug: string }

const allResults: SetupResults[] = []

async function workAtOnce<Item>(items: Item[], size: number, work: (item: Item) => Promise<void>) {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(work))
  }
}

async function measure<Result>(
  times: number,
  work: (index: number) => Promise<Result>,
  check?: (index: number, result: Result) => Promise<void> | void
): Promise<Timing> {
  const durations: number[] = []
  for (let index = 0; index < times; index++) {
    const start = performance.now()
    const result = await work(index)
    durations.push(performance.now() - start)
    await check?.(index, result)
  }
  durations.sort((first, second) => first - second)
  return { median: durations[Math.floor(times / 2)]!, p95: durations[Math.floor(times * 0.95)]! }
}

function pathsBelow(
  parent: Seeded | undefined,
  collection: SeededCollection,
  slug: string,
  localized: boolean
): Record<string, string> {
  const swedishSlug = collection === 'pages' ? `${slug}-sv` : slug
  const start = (locale: string) => parent?.paths[locale] ?? BASE_PATHS[collection]
  return localized ? { en: `${start('en')}/${slug}`, sv: `${start('sv')}/${swedishSlug}` } : { '': `${start('')}/${slug}` }
}

async function seed(payload: Payload, setup: Setup, { compared }: { compared: boolean }) {
  const concurrency = SEED_CONCURRENCY[setup.database]
  // By collection and id, as collections may share ids on SQL.
  const ancestorsOf = new Map<string, Id[]>()
  const breadcrumbsOf = new Map<string, Breadcrumb[]>()
  let seededCount = 0
  const seedOne = async (collection: SeededCollection, slug: string, parent: Seeded | undefined, index: number) => {
    const key = (id: Seeded['id']) => `${collection}:${id}`
    const paths = pathsBelow(parent, collection, slug, setup.localized)
    const ancestors = parent ? [...ancestorsOf.get(key(parent.id))!, parent.id] : []
    const breadcrumbs = (id: Seeded['id'] | undefined, label: string): Breadcrumb[] => [
      ...(parent ? breadcrumbsOf.get(key(parent.id))! : []),
      { doc: id, label, url: paths['']! }
    ]
    // Nested docs writes the breadcrumbs on every save, labelled with the title. The last one names
    // the document from its second save on, as the plugin's own create writes it.
    const breadcrumbsOnSave = (id: Seeded['id'] | undefined, title: string) =>
      collection === NESTED_PAGES ? { breadcrumbs: breadcrumbs(id, title) } : {}
    const title = `${collection === 'posts' ? 'Post' : 'Page'} ${slug}`
    // Pages and posts hold the path and ancestors the plugin stores, so its first save of each writes
    // none again.
    const pathFields =
      collection === 'pages' || collection === 'posts' ? { ancestors, path: setup.localized ? paths.en : paths[''] } : {}
    const created = await create(payload, collection, {
      parent: parent?.id,
      slug,
      title,
      ...pathFields,
      ...breadcrumbsOnSave(undefined, title)
    })
    // A second version: the Swedish translation with localization, an edited title without.
    const edited = setup.localized ? `${title} (sv)` : `${title}, edited`
    await update(
      payload,
      collection,
      created.id,
      setup.localized
        ? { path: paths.sv, slug: collection === 'pages' ? `${slug}-sv` : slug, title: edited }
        : { title: edited, ...breadcrumbsOnSave(created.id, edited) },
      { locale: setup.localized ? 'sv' : undefined }
    )
    if (index % 10 === 0) {
      const draft = { title: `${title}, draft`, ...breadcrumbsOnSave(created.id, `${title}, draft`) }
      await update(payload, collection, created.id, draft, { autosave: true, draft: true })
    }
    ancestorsOf.set(key(created.id), ancestors)
    if (collection === NESTED_PAGES) breadcrumbsOf.set(key(created.id), breadcrumbs(created.id, edited))
    if (++seededCount % 10_000 === 0) logMemory(`${setup.name}: seeded ${seededCount.toLocaleString('en')} documents`)
    return { collection, id: created.id, paths, slug } satisfies Seeded
  }
  // The documents come back in the order they were asked for, whichever of the ones written at once
  // the database finished first, so pick finds the same ones on every database.
  const seedAll = async (specs: { collection: SeededCollection; parent?: Seeded; slug: string }[]) => {
    const seeded = new Array<Seeded>(specs.length)
    await workAtOnce(
      specs.map((spec, index) => ({ ...spec, index })),
      concurrency,
      async ({ collection, index, parent, slug }) => {
        seeded[index] = await seedOne(collection, slug, parent, index)
      }
    )
    return seeded
  }

  const seedPages = async (collection: SeededCollection) => {
    const sections = await seedAll(Array.from({ length: 10 }, (_, index) => ({ collection, slug: `section-${index}` })))
    const children = await seedAll(
      sections.flatMap((section) =>
        Array.from({ length: 10 }, (_, index) => ({ collection, parent: section, slug: `child-${index}` }))
      )
    )
    const grandchildren = await seedAll(
      children.flatMap((child) => Array.from({ length: 9 }, (_, index) => ({ collection, parent: child, slug: `leaf-${index}` })))
    )
    const [moved] = await seedAll([{ collection, slug: 'moved' }])
    const shelves = await seedAll(
      Array.from({ length: 10 }, (_, index) => ({ collection, parent: moved, slug: `shelf-${index}` }))
    )
    const items = await seedAll(
      Array.from({ length: MOVE_SIZE - shelves.length }, (_, index) => ({
        collection,
        parent: shelves[index % shelves.length],
        slug: `item-${index}`
      }))
    )
    const line: Seeded[] = []
    for (let level = 1; level <= DEEP_LEVELS; level++) line.push(await seedOne(collection, `level-${level}`, line.at(-1), level))
    const all = [...sections, ...children, ...grandchildren, moved!, ...shelves, ...items, ...line]
    if (all.length !== PAGES) throw new Error(`The site holds ${all.length} pages, not the ${PAGES} that PAGES counts`)
    return {
      byPath: new Map(all.map((page) => [page.paths[setup.localized ? 'en' : '']!, page])),
      sections: [...sections, ...children, ...grandchildren]
    }
  }

  const pages = await seedPages('pages')
  const topics = await seedAll(
    Array.from({ length: POST_TOPICS }, (_, index) => ({ collection: 'posts', slug: `topic-${index}` }))
  )
  const posts = await seedAll(
    Array.from({ length: DOCUMENTS - PAGES - POST_TOPICS }, (_, index) => ({
      collection: 'posts',
      parent: topics[index % topics.length],
      slug: `post-${index}`
    }))
  )
  const copies = compared
    ? { [NESTED_PAGES]: (await seedPages(NESTED_PAGES)).byPath, [PLAIN_PAGES]: (await seedPages(PLAIN_PAGES)).byPath }
    : undefined
  // The saves change posts with nothing below them, as most posts are.
  return { copies, documents: [...pages.sections, ...topics, ...posts], pages: pages.byPath, posts }
}

type Site = Awaited<ReturnType<typeof seed>>

// Picks the same documents on every database, so each one does the same work.
const pick = <Item>(items: Item[], index: number) => items[(index * 7919) % items.length]!

const pagesOf = (site: Site, method: Method) => {
  const collection = METHOD_COLLECTIONS[method]
  return collection === 'pages' ? site.pages : site.copies![collection]
}

// Each method finds each page once untimed first, so all three are timed finding the same page.
async function timeLookups(payload: Payload, site: Site) {
  const lookups: SetupResults['lookups'] = []
  for (const { depth, path } of LOOKUP_PATHS) {
    for (const method of METHODS) {
      const expected = pagesOf(site, method).get(path)!.id
      const found = await LOOKUP_METHODS[method](payload, path)
      if (found?.id !== expected) throw new Error(`${method} found ${String(found?.id)} at ${path}, not ${expected}`)
      lookups.push({ depth, method, ...(await measure(LOOKUPS, () => LOOKUP_METHODS[method](payload, path))) })
    }
  }
  return lookups
}

async function readMovedPath(payload: Payload, method: MovedMethod, id: Id) {
  const document = await readDocument(payload, METHOD_COLLECTIONS[method], id)
  return method === 'path' ? document.path : (document.breadcrumbs as Breadcrumb[] | undefined)?.at(-1)?.url
}

// Each method finishes before the next starts, so path's moves run before nested docs' writes can slow
// the database down.
async function timeMoves(payload: Payload, site: Site, methods: readonly MovedMethod[]) {
  const moves: SetupResults['moves'] = []
  for (const method of methods) {
    for (const { below, page, runs } of MOVES) {
      const pages = pagesOf(site, method)
      const pathsBelow = [...pages.keys()].filter((path) => path.startsWith(`${page}/`))
      if (pathsBelow.length !== below) throw new Error(`${page} holds ${pathsBelow.length} pages, not ${below}`)
      const deepest = pathsBelow.reduce((deepestPath, path) =>
        path.split('/').length > deepestPath.split('/').length ? path : deepestPath
      )
      const { id, slug } = pages.get(page)!
      const renamed = (index: number) => `${slug}-${index}`
      const rename = (index: number) => update(payload, METHOD_COLLECTIONS[method], id, { slug: renamed(index) })
      const check = async (index: number) => {
        const expected = `${page.slice(0, page.lastIndexOf('/'))}/${renamed(index)}${deepest.slice(page.length)}`
        const moved = await readMovedPath(payload, method, pages.get(deepest)!.id)
        if (moved !== expected) throw new Error(`${method} left ${deepest} at ${String(moved)}, not ${expected}`)
      }
      moves.push({ below, method, runs, ...(await measure(runs, rename, check)) })
    }
  }
  return moves
}

await checkReadme(RUN, SETUPS.length)

describe.each(SETUPS)('$name', (setup) => {
  it(`seeds ${DOCUMENTS.toLocaleString('en')} documents and times the plugin on them`, async () => {
    const compared = COMPARISON && !setup.localized
    // Seeding runs without the plugins' hooks, so it needs no transactions. On SQLite, @libsql/client
    // 0.14 keeps each transaction's connection open, which seeding would grow to tens of gigabytes.
    const seeding = await startPayload(setup, {
      collections: compared ? await comparedCollections({ hooks: false }) : [],
      plugin: false,
      transactions: false
    })
    const startedSeeding = performance.now()
    const site = await seed(seeding.payload, setup, { compared })
    logMemory(`${setup.name}: seeded in ${Math.round((performance.now() - startedSeeding) / 1000)} s`)
    await seeding.payload.destroy()

    const { payload } = await startPayload(setup, {
      collections: compared ? await comparedCollections({ hooks: true }) : [],
      database: seeding.database,
      options: { collections: COLLECTIONS }
    })
    const locales = setup.localized ? LOCALES : ['']
    const operations: SetupResults['operations'] = []
    const time = async (name: string, timing: Promise<Timing>) => void operations.push({ name, ...(await timing) })

    const lookedUp = (index: number) => {
      const locale = locales[index % locales.length]!
      const document = pick(site.documents, index)
      return { document, locale, path: document.paths[locale]! }
    }
    await time(
      'Lookup by path',
      measure(
        LOOKUPS,
        (index) => {
          const { locale, path } = lookedUp(index)
          return findByPath({ locale: locale || undefined, path, payload })
        },
        (index, found) => {
          const { document, path } = lookedUp(index)
          if (found?.collection !== document.collection || found.document.id !== document.id) {
            const what = found ? `${found.collection} ${found.document.id}` : 'nothing'
            throw new Error(`findByPath found ${what} at ${path}, not ${document.collection} ${document.id}`)
          }
        }
      )
    )
    await time(
      'Autosave',
      measure(SAVES, (index) =>
        update(payload, 'posts', pick(site.posts, index).id, { title: `Autosaved ${index}` }, { autosave: true, draft: true })
      )
    )
    await time(
      'Publish, same slug',
      measure(SAVES, (index) => update(payload, 'posts', pick(site.posts, index + SAVES).id, { title: `Published ${index}` }))
    )
    await time(
      'Publish, new slug',
      measure(SAVES, (index) => {
        const post = pick(site.posts, index + 2 * SAVES)
        return update(payload, 'posts', post.id, { slug: `${post.slug}-renamed-${index}` })
      })
    )
    const lookups = compared ? await timeLookups(payload, site) : []
    const moves = await timeMoves(payload, site, compared ? MOVED_METHODS : ['path'])
    // The largest move is the benchmark's own row too.
    const { median, p95 } = moves.find(({ below, method }) => below === MOVE_SIZE && method === 'path')!
    operations.push({ median, name: `Move of ${MOVE_SIZE.toLocaleString('en')} pages`, p95 })

    const results: SetupResults = { database: setup.database, localized: setup.localized, lookups, moves, operations }
    allResults.push(results)
    printSetup(results)
    logMemory(`${setup.name}: timed`)
    await payload.destroy()
  })
})

afterAll(async () => {
  printAll(allResults)
  await writeReport(allResults, RUN)
})
