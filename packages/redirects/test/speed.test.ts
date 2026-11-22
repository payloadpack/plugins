import type { SQLiteAdapter } from '@payloadcms/db-sqlite'
import type { CollectionSlug, Payload } from 'payload'
import { generateNKeysBetween } from 'payload/shared'
import { beforeAll, expect, it } from 'vitest'

import { buildDocumentKey } from '../src/fields/target-document-key.js'
import { findRedirect } from '../src/index.js'
import { suggestionsEndpoint } from '../src/plugin/suggestions-endpoint.js'
import { buildFixedStart } from '../src/redirect/regex.js'
import type { Query } from './support/adapters.js'
import { describeSite } from './support/boot-payload.js'
import {
  buildSuggestionsRequest,
  createEditorRequest,
  createRedirect,
  findFoundRedirect,
  publish,
  publishChange,
  recordHasDocument,
  remove,
  toDocument,
  toUrl
} from './support/documents.js'
import { findMongodbPlan, findPostgresIndexes, findSqlitePlan } from './support/query-plan.js'
import { measureFastestRun } from './support/timing.js'

const SEEDED_COUNT = 500

// Many redirects from paths and many regexes, each regex below a section of its own.
async function seedRedirects(payload: Payload) {
  const orders = generateNKeysBetween(null, null, 2 * SEEDED_COUNT)
  const now = new Date().toISOString()
  const row = (index: number, from: string, match: string, url: string) => ({
    _order: orders[index],
    createdAt: now,
    status: 'on',
    from,
    match,
    lookupPath: match === 'regex' ? buildFixedStart(from) : from,
    targetDocumentKey: null,
    to: { type: 'url', url },
    type: 'permanent',
    updatedAt: now
  })
  const rows = [
    ...Array.from({ length: SEEDED_COUNT }, (_, index) => row(index, `/seeded-${index}/old`, 'below', `/new-${index}`)),
    ...Array.from({ length: SEEDED_COUNT }, (_, index) =>
      row(SEEDED_COUNT + index, `/section-${index}/(\\d+)/(.*)`, 'regex', `/moved-${index}/$2`)
    )
  ]
  await storeInBatches(payload, 'redirects', rows)
}

// Through the database adapter, so no hook runs.
async function storeInBatches(payload: Payload, collection: CollectionSlug, rows: Record<string, unknown>[]) {
  for (let start = 0; start < rows.length; start += 100) {
    await Promise.all(rows.slice(start, start + 100).map((data) => payload.db.create({ collection, data })))
  }
}

const describeQuery = ({ collection, operation }: Query) => `${operation} ${collection}`

const READ_OPERATIONS = { mongodb: 'find', postgres: 'select', sqlite: 'select' }

const depthOf = (path: string) => path.split('/').length - 1

// The redirects, and on Postgres and SQLite the tables that hold their relationships, such as
// redirects_rels, and any table of versions, which the collection has none of.
const isRedirects = ({ collection }: Query) => /^_?redirects(_|$)/.test(collection)

// What a move writes to the redirects: the one suggestion from the old path, with its relationships,
// to the moved document and to the editor who moved it, in a table of their own on Postgres and SQLite.
const MOVE_WRITES = {
  mongodb: ['insert redirects'],
  postgres: ['insert redirects', 'insert redirects_rels'],
  sqlite: ['insert redirects', 'insert redirects_rels']
}

// What a lookup's plan on SQLite reads of the redirects: a search of one index for each value asked.
const LOOKUP_SEARCHES = ['SEARCH redirects USING INDEX redirects_lookup_path_idx (lookup_path=?)']

// The index of a redirect's document target, which holds every redirect to a document, whatever its
// status.
const MONGODB_TARGET_INDEX = 'targetDocumentKey_1'

// The longest path a lookup takes asks for its 32 paths and / in lookupPath, and for each path again as
// the visitor typed it where that differs.
const LONGEST_LOOKUP_MS = 5

describeSite('the cost of a lookup and a move', {}, (site, { database }) => {
  const readOperation = READ_OPERATIONS[database]

  beforeAll(() => seedRedirects(site.payload))

  // A lookup's own query.
  async function recordLookup(path: string, req?: Parameters<typeof findRedirect>[0]['req']) {
    const queries = await site.listQueries(() => findRedirect({ path, payload: site.payload, req }))
    return queries.find(({ collection }) => collection === 'redirects')!
  }

  const LOOKED_UP_PATHS = ['/seeded-7/old/deeper/still', '/section-7/2024/spring', '/nothing/at/all/here/x']

  if (database === 'mongodb') {
    it('finds the candidates with an index scan of lookupPath alone', async () => {
      for (const path of LOOKED_UP_PATHS) {
        const plan = await findMongodbPlan(site.payload, await recordLookup(path))

        expect(plan.stages).not.toContain('COLLSCAN')
        expect(plan.indexes).toEqual(['lookupPath_1'])
        // One key for each value asked, its paths and /, and one more for each redirect found.
        expect(plan.keysExamined).toBeLessThanOrEqual(depthOf(path) + 1 + plan.returned)
        expect(plan.documentsExamined).toBeLessThanOrEqual(plan.returned)
      }
    })

    // Payload's orderable puts a new redirect last, and finds the last one with a sort on _order and
    // createdAt, which the index the plugin adds serves.
    it('puts a new redirect last from one key of the index the plugin adds', async () => {
      const queries = await site.listQueries(() => createRedirect(site.payload, { from: '/last', to: toUrl('/x') }))
      const findLast = queries.find(({ collection, operation }) => collection === 'redirects' && operation === 'find')!

      expect(await findMongodbPlan(site.payload, findLast)).toMatchObject({
        documentsExamined: 1,
        indexes: ['_order_1_createdAt_1'],
        keysExamined: 1
      })
    })

    it("runs the same query plan on a signed-in user's request", async () => {
      const req = await createEditorRequest(site.payload)

      expect(await findMongodbPlan(site.payload, await recordLookup('/seeded-8/old/x', req))).toMatchObject({
        indexes: ['lookupPath_1'],
        returned: 1
      })
    })

    it("finds a document's suggestions on the index of document targets alone, reading only the redirects to it", async () => {
      const harbour = await publish(site.payload, 'pages', { slug: 'harbour', title: 'Harbour' })
      await publishChange(site.payload, 'pages', harbour, { slug: 'quay' })
      // A redirect to the same page that is on, which the index holds too and the status leaves out.
      await createRedirect(site.payload, { from: '/to-quay', to: toDocument('pages', harbour) })
      const req = await createEditorRequest(site.payload, buildSuggestionsRequest('pages', harbour))
      const queries = await site.listQueries(async () => suggestionsEndpoint.handler(req))
      const findSuggestions = queries.find(({ collection, operation }) => collection === 'redirects' && operation === 'find')!

      expect(await findMongodbPlan(site.payload, findSuggestions)).toMatchObject({
        documentsExamined: 2,
        indexes: [MONGODB_TARGET_INDEX],
        returned: 1
      })
    })
  }

  // SQLite keeps no statistics until a site runs ANALYZE, so the plan depends on the statement alone:
  // one search of the index for the values asked for, and none of the whole table.
  if (database === 'sqlite') {
    it('finds the candidates with a search of the index on lookupPath alone', async () => {
      for (const path of LOOKED_UP_PATHS) {
        const plan = await findSqlitePlan(site.payload, await recordLookup(path))

        expect(plan.filter((line) => /^(SCAN|SEARCH) redirects\b/.test(line))).toEqual(LOOKUP_SEARCHES)
      }
    })

    // SQLite reads the index Payload gives _order from its end, and sorts only the redirects that share
    // the last _order by createdAt, so it stops at the first.
    it('puts a new redirect last from the end of the index on _order', async () => {
      const queries = await site.listQueries(() => createRedirect(site.payload, { from: '/last', to: toUrl('/x') }))
      const findLast = queries.find(({ collection, operation }) => collection === 'redirects' && operation === 'select')!

      expect(await findSqlitePlan(site.payload, findLast)).toEqual([
        'SEARCH redirects USING INDEX redirects__order_idx (_order>?)',
        'USE TEMP B-TREE FOR RIGHT PART OF ORDER BY'
      ])
    })

    it("runs the same query plan on a signed-in user's request", async () => {
      const req = await createEditorRequest(site.payload)
      const plan = await findSqlitePlan(site.payload, await recordLookup('/seeded-8/old/x', req))

      expect(plan.filter((line) => /^(SCAN|SEARCH) redirects\b/.test(line))).toEqual(LOOKUP_SEARCHES)
    })
  }

  // Postgres picks a plan by its cost, and on a table this small reads the whole table whatever its
  // indexes, so the test holds that the indexes a lookup and a save read are there.
  if (database === 'postgres') {
    it('keeps the index a lookup reads, on lookupPath, the one a save reads, on _order, and the one of document targets', async () => {
      expect(await findPostgresIndexes(site.payload, 'redirects')).toEqual(
        expect.arrayContaining(['redirects(lookup_path)', 'redirects(_order)', 'redirects(target_document_key)'])
      )
    })
  }

  // On Postgres and SQLite the relationship of a document target comes in the same statement.
  it('asks the database once for a path no redirect covers, and once for a URL target', async () => {
    const lookups = {
      miss: () => findRedirect({ path: '/nothing/here', payload: site.payload }),
      missWithQueryString: () => findRedirect({ path: '/nothing/here', payload: site.payload, searchParams: { id: '1' } }),
      path: () => findRedirect({ path: '/seeded-9/old/x', payload: site.payload }),
      regex: () => findRedirect({ path: '/section-9/2024/x', payload: site.payload })
    }

    for (const lookup of Object.values(lookups)) {
      expect((await site.listQueries(lookup)).map(describeQuery)).toEqual([`${readOperation} redirects`])
    }
  })

  it('reads a document target once more, for its path, and only the target of the redirect that wins', async () => {
    const page = await publish(site.payload, 'pages', { slug: 'target', title: 'Target' })
    await createRedirect(site.payload, { from: '/to-target', match: 'below', to: toDocument('pages', page) })
    await createRedirect(site.payload, { from: '/to-target/url', to: toUrl('/elsewhere') })
    await createRedirect(site.payload, { from: '/to-target?id=1', to: toUrl('/by-query') })
    await createRedirect(site.payload, { from: '/to-target?id=2', to: toDocument('pages', page) })
    const lookUp = (path: string, searchParams?: Record<string, string>) =>
      site.listQueries(() => findRedirect({ path, payload: site.payload, searchParams }))

    expect((await lookUp('/to-target')).map(describeQuery)).toEqual([`${readOperation} redirects`, `${readOperation} pages`])
    // The redirect from /to-target above it, to a page, is a candidate too.
    expect((await lookUp('/to-target/url')).map(describeQuery)).toEqual([`${readOperation} redirects`])
    expect((await lookUp('/to-target', { id: '1' })).map(describeQuery)).toEqual([`${readOperation} redirects`])
    expect((await lookUp('/to-target', { id: '2' })).map(describeQuery)).toEqual([
      `${readOperation} redirects`,
      `${readOperation} pages`
    ])
  })

  it('asks once for the suggestions of a document no move suggested a redirect to, and reads one only when it has one', async () => {
    const meadow = await publish(site.payload, 'pages', { slug: 'meadow', title: 'Meadow' })
    const pasture = await publish(site.payload, 'pages', { slug: 'pasture', title: 'Pasture' })
    await publishChange(site.payload, 'pages', pasture, { slug: 'field' })
    const listEndpointQueries = async (page: { id: number | string }) => {
      const req = await createEditorRequest(site.payload, buildSuggestionsRequest('pages', page))
      return (await site.listQueries(async () => suggestionsEndpoint.handler(req))).map(describeQuery)
    }

    expect(await listEndpointQueries(meadow)).toEqual([`${readOperation} redirects`])
    expect(await listEndpointQueries(pasture)).toEqual(
      expect.arrayContaining([`${readOperation} redirects`, expect.stringMatching(/ _?pages/)])
    )
  })

  // Every page deleted asks for its suggestions, on the index of document targets alone.
  it('asks once for the suggestions of a deleted page, and reads none more when it has none', async () => {
    const shed = await publish(site.payload, 'pages', { slug: 'shed', title: 'Shed' })
    // An editor's redirect to the page, which is no suggestion and stays.
    await createRedirect(site.payload, { from: '/to-shed', to: toDocument('pages', shed) })

    const queries = (await site.listQueries(() => remove(site.payload, 'pages', shed))).filter(isRedirects)

    expect(queries.map(describeQuery)).toEqual([`${readOperation} redirects`])
    if (database === 'mongodb') {
      expect(await findMongodbPlan(site.payload, queries[0]!)).toMatchObject({
        documentsExamined: 1,
        indexes: [MONGODB_TARGET_INDEX],
        keysExamined: 1
      })
    }
  })

  it('writes the same suggestion for a branch with 1,000 pages below as for one with 3', async () => {
    const writesOfMove = async (below: number) => {
      const top = await publish(site.payload, 'pages', { slug: `branch-${below}`, title: 'Top' })
      const shelf = await publish(site.payload, 'pages', { parent: top.id, slug: 'shelf', title: 'Shelf' })
      await storePagesBelow(site.payload, [top.id, shelf.id], `/branch-${below}/shelf`, below - 1)
      // As an editor moves it, whom Payload records on the suggestion as who created it and last saved it.
      const req = await createEditorRequest(site.payload)
      const queries = await site.listQueries(() =>
        publishChange(site.payload, 'pages', top, { slug: `branch-${below}-moved` }, { req })
      )
      expect(site.changes.at(-1)).toHaveLength(below + 1)
      return queries.filter(isRedirects).map(describeQuery)
    }

    const writesOfLargeMove = await writesOfMove(1_000)

    expect(writesOfLargeMove).toEqual(await writesOfMove(3))
    expect(writesOfLargeMove.filter((write) => !write.startsWith(`${readOperation} `))).toEqual(MOVE_WRITES[database])
  })

  it(`answers a lookup at the longest path it looks up, 2,048 characters in 32 segments, within ${LONGEST_LOOKUP_MS} ms`, async () => {
    await createRedirect(site.payload, { from: '/a', match: 'below', to: toUrl('/b') })
    const longest = `/a${`/${'a'.repeat(62)}`.repeat(31)}${'a'.repeat(2_048 - 2 - 63 * 31)}`
    expect(longest).toHaveLength(2_048)
    expect(longest.split('/')).toHaveLength(33)

    expect((await findFoundRedirect({ path: longest, payload: site.payload }))?.destination).toBe(
      `/b${longest.slice('/a'.length)}`
    )
    expect(await measureFastestRun(() => findRedirect({ path: longest, payload: site.payload }))).toBeLessThan(LONGEST_LOOKUP_MS)
  })
})

// With statistics, SQLite estimates an equality on an indexed column from how many redirects share each
// value, so a value most redirects share, such as the null of a column only regexes fill, would have it
// read every redirect rather than search.
describeSite('the cost of a lookup on SQLite, also with statistics', {}, (site, { database }) => {
  it.runIf(database === 'sqlite')(
    'searches the indexes for mostly redirects from paths, for half regexes and for only regexes, never scanning',
    async () => {
      const shapes = { mostlyPaths: 3, halfRegexes: 1_500, onlyRegexes: 3_000 }
      for (const [shape, regexCount] of Object.entries(shapes)) {
        await site.payload.db.deleteMany({ collection: 'redirects', where: { id: { exists: true } } })
        const now = new Date().toISOString()
        await storeInBatches(
          site.payload,
          'redirects',
          generateNKeysBetween(null, null, 3_000).map((order, index) => {
            const regex = index < regexCount
            const from = regex ? `/${shape}-legacy-${index}/(.*)` : `/${shape}-area-${index % 50}/old-${index}`
            return {
              _order: order,
              createdAt: now,
              from,
              match: regex ? 'regex' : 'below',
              lookupPath: regex ? buildFixedStart(from) : from,
              status: 'on',
              targetDocumentKey: null,
              to: toUrl(regex ? '/archive/$1' : `/new-${index}`),
              type: 'permanent',
              updatedAt: now
            }
          })
        )
        const findPlans = async () => {
          const plans: string[][] = []
          for (const path of [`/${shape}-area-49/old-2999/x`, `/${shape}-legacy-0/x`, '/nothing/at/all']) {
            const queries = await site.listQueries(() => findRedirect({ path, payload: site.payload }))
            const plan = await findSqlitePlan(site.payload, queries.find(isRedirects)!)
            plans.push(plan.filter((line) => /^(SCAN|SEARCH) redirects\b/.test(line)))
          }
          return plans
        }

        expect({ shape, plans: await findPlans() }).toEqual({ shape, plans: [LOOKUP_SEARCHES, LOOKUP_SEARCHES, LOOKUP_SEARCHES] })
        await (site.payload.db as unknown as SQLiteAdapter).client.execute('ANALYZE')
        expect({ shape, plans: await findPlans() }).toEqual({ shape, plans: [LOOKUP_SEARCHES, LOOKUP_SEARCHES, LOOKUP_SEARCHES] })
      }
    }
  )
})

// A site that runs ANALYZE, or PRAGMA optimize, gives SQLite statistics, which count every redirect
// without a document target, such as one to a URL, as one value of the index, so the more of those, the
// more redirects SQLite expects a document's suggestions to read. Without STAT4, which libsql leaves
// out, nothing tells it that a document's value holds a few.
describeSite("the cost of a document's suggestions on SQLite, also with statistics", {}, (site, { database }) => {
  it.runIf(database === 'sqlite')(
    'searches the index of document targets for the notices and a delete, whatever share of redirects sends visitors to a document',
    async () => {
      // One at a time: SQLite with transactions refuses a save that starts while another is open.
      const pages: { id: number | string }[] = []
      for (let index = 0; index < 20; index++) {
        pages.push(await publish(site.payload, 'pages', { slug: `shelf-${index}`, title: 'Shelf' }))
      }
      const SEARCH_TARGETS = ['SEARCH redirects USING INDEX redirects_target_document_key_idx (target_document_key=?)']
      const findTablePlan = async (query: Query) =>
        (await findSqlitePlan(site.payload, query)).filter((line) => /^(SCAN|SEARCH) /.test(line))
      // None, one in a hundred and every second of 20,000 redirects to a page, the rest to a URL: below
      // a few thousand, SQLite searches whatever the order asked for.
      for (const share of [0, 0.01, 0.5]) {
        await site.payload.db.deleteMany({ collection: 'redirects', where: { id: { exists: true } } })
        const now = new Date().toISOString()
        await storeInBatches(
          site.payload,
          'redirects',
          generateNKeysBetween(null, null, 20_000).map((order, index) => {
            const page = share > 0 && index % Math.round(1 / share) === 0 ? pages[index % pages.length]! : undefined
            return {
              _order: order,
              createdAt: now,
              from: `/stored-${share}-${index}`,
              match: 'exact',
              status: 'on',
              targetDocumentKey: page ? buildDocumentKey('pages', page.id) : null,
              to: page ? toDocument('pages', page) : toUrl('/elsewhere'),
              type: 'permanent',
              updatedAt: now
            }
          })
        )
        const moved = await publish(site.payload, 'pages', { slug: `atlas-${share}`, title: 'Atlas' })
        await publishChange(site.payload, 'pages', moved, { slug: `globe-${share}` })
        const deleted = await publish(site.payload, 'pages', { slug: `chart-${share}`, title: 'Chart' })
        await publishChange(site.payload, 'pages', deleted, { slug: `map-${share}` })
        const almanac = await publish(site.payload, 'news', { slug: `almanac-${share}`, title: 'Almanac' })
        const findNoticesQuery = async (collection: string, document: { id: number | string }) => {
          const req = await createEditorRequest(site.payload, buildSuggestionsRequest(collection, document))
          return (await site.listQueries(async () => suggestionsEndpoint.handler(req))).find(isRedirects)!
        }
        const queries = {
          delete: (await site.listQueries(() => remove(site.payload, 'pages', deleted))).find(isRedirects)!,
          news: await findNoticesQuery('news', almanac),
          page: await findNoticesQuery('pages', moved),
          pageOfMany: await findNoticesQuery('pages', pages[0]!)
        }
        const findPlans = async () =>
          Object.fromEntries(
            await Promise.all(Object.entries(queries).map(async ([name, query]) => [name, await findTablePlan(query)]))
          )
        const searchesEverywhere = {
          delete: SEARCH_TARGETS,
          news: SEARCH_TARGETS,
          page: SEARCH_TARGETS,
          pageOfMany: SEARCH_TARGETS
        }

        expect(await findPlans()).toEqual(searchesEverywhere)
        await (site.payload.db as unknown as SQLiteAdapter).client.execute('ANALYZE')
        expect(await findPlans()).toEqual(searchesEverywhere)
      }
    },
    600_000
  )
})

describeSite(
  "the cost of a lookup with winOverDocuments 'perRedirect'",
  { redirects: { winOverDocuments: 'perRedirect' } },
  (site, { database }) => {
    const readOperation = READ_OPERATIONS[database]
    // Answers from memory, so every query listed is findRedirect's own.
    const { askedPaths, hasDocument, heldPaths } = recordHasDocument()
    const lookUp = async (path: string, searchParams?: Record<string, string>) => {
      askedPaths.length = 0
      const queries = await site.listQueries(() => findRedirect({ hasDocument, path, payload: site.payload, searchParams }))
      return { askedCount: askedPaths.length, queries: queries.map(describeQuery) }
    }

    it("asks the database once, and hasDocument only when the best redirect can't win over a document", async () => {
      await createRedirect(site.payload, { from: '/cost-unpicked', to: toUrl('https://other.example/a') })
      await createRedirect(site.payload, { from: '/cost-picked', to: toUrl('https://other.example/b'), winsOverDocument: true })
      await createRedirect(site.payload, { from: '/cost-picked/below', to: toUrl('https://other.example/c') })
      heldPaths.add('/cost-unpicked')
      heldPaths.add('/cost-picked/below')

      expect(await lookUp('/nothing/here')).toEqual({ askedCount: 0, queries: [`${readOperation} redirects`] })
      expect(await lookUp('/nothing/here', { id: '1' })).toEqual({ askedCount: 0, queries: [`${readOperation} redirects`] })
      expect(await lookUp('/cost-unpicked')).toEqual({ askedCount: 1, queries: [`${readOperation} redirects`] })
      expect(await lookUp('/cost-picked')).toEqual({ askedCount: 0, queries: [`${readOperation} redirects`] })
      expect(await lookUp('/cost-picked/below')).toEqual({ askedCount: 1, queries: [`${readOperation} redirects`] })
    })

    it('reads the document target of only the redirect that wins', async () => {
      const page = await publish(site.payload, 'pages', { slug: 'cost-target', title: 'Cost target' })
      await createRedirect(site.payload, { from: '/cost-document', to: toDocument('pages', page) })
      await createRedirect(site.payload, { from: '/cost-document?id=1', to: toDocument('pages', page) })
      heldPaths.add('/cost-document')

      expect(await lookUp('/cost-document')).toEqual({ askedCount: 1, queries: [`${readOperation} redirects`] })
      expect(await lookUp('/cost-document', { id: '1' })).toEqual({
        askedCount: 0,
        queries: [`${readOperation} redirects`, `${readOperation} pages`, `${readOperation} redirects`]
      })
    })
  }
)

// Every path on this site a chain lands on costs one lookup more, the one where it ends included.
describeSite(
  "the cost of a lookup with winOverDocuments 'always'",
  { redirects: { winOverDocuments: 'always' } },
  (site, { database }) => {
    const readOperation = READ_OPERATIONS[database]
    const lookUp = async (path: string) =>
      (await site.listQueries(() => findRedirect({ path, payload: site.payload }))).map(describeQuery)

    it('asks the database once per path a chain looks up', async () => {
      await createRedirect(site.payload, { from: '/cost-away', to: toUrl('https://other.example/away') })
      await createRedirect(site.payload, { from: '/cost-hop-1', to: toUrl('/cost-hop-2') })
      await createRedirect(site.payload, { from: '/cost-hop-2', to: toUrl('/cost-hop-3') })

      expect(await lookUp('/nothing/here')).toEqual([`${readOperation} redirects`])
      expect(await lookUp('/cost-away')).toEqual([`${readOperation} redirects`])
      expect(await lookUp('/cost-hop-2')).toEqual([`${readOperation} redirects`, `${readOperation} redirects`])
      expect(await lookUp('/cost-hop-1')).toEqual([
        `${readOperation} redirects`,
        `${readOperation} redirects`,
        `${readOperation} redirects`
      ])
    })
  }
)

async function storePagesBelow(payload: Payload, ancestors: (number | string)[], parentPath: string, count: number) {
  const now = new Date().toISOString()
  const pages = Array.from({ length: count }, (_, index) => ({
    _status: 'published',
    ancestors,
    createdAt: now,
    parent: ancestors.at(-1),
    path: `${parentPath}/item-${index}`,
    slug: `item-${index}`,
    title: `Item ${index}`,
    updatedAt: now
  }))
  await storeInBatches(payload, 'pages', pages)
}
