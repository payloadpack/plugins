import type { CollectionSlug, Payload } from 'payload'
import { generateNKeysBetween } from 'payload/shared'
import { beforeAll, expect, it } from 'vitest'

import { findRedirect } from '../src/index.js'
import { suggestionsEndpoint } from '../src/plugin/suggestions-endpoint.js'
import { buildRegexPath } from '../src/redirect/regex.js'
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
    regexPath: match === 'regex' ? buildRegexPath(from) : null,
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

// The longest path a lookup takes asks for 32 paths in from and 33 in regexPath.
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
    it('finds the candidates with index scans of from and regexPath alone', async () => {
      for (const path of LOOKED_UP_PATHS) {
        const plan = await findMongodbPlan(site.payload, await recordLookup(path))

        expect(plan.stages).not.toContain('COLLSCAN')
        expect(plan.indexes).toEqual(['from_1', 'regexPath_1'])
        expect(plan.keysExamined).toBeLessThanOrEqual(2 * depthOf(path) + 2)
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
        indexes: ['from_1', 'regexPath_1'],
        returned: 1
      })
    })

    it("finds a document's suggestions on an index that holds only suggestions", async () => {
      const harbour = await publish(site.payload, 'pages', { slug: 'harbour', title: 'Harbour' })
      await publishChange(site.payload, 'pages', harbour, { slug: 'quay' })
      // A redirect to the same page that is on, which only an index of every redirect would hold.
      await createRedirect(site.payload, { from: '/to-quay', to: toDocument('pages', harbour) })
      const req = await createEditorRequest(site.payload, buildSuggestionsRequest('pages', harbour))
      const queries = await site.listQueries(async () => suggestionsEndpoint.handler(req))
      const findSuggestions = queries.find(({ collection, operation }) => collection === 'redirects' && operation === 'find')!

      expect(await findMongodbPlan(site.payload, findSuggestions)).toMatchObject({
        documentsExamined: 1,
        indexes: ['to.document.value_1'],
        returned: 1
      })
    })
  }

  // SQLite keeps no statistics, so the plan depends on the statement alone: one search of each index
  // per path asked for, and none of the whole table.
  if (database === 'sqlite') {
    const LOOKUP_INDEXES = [
      'SEARCH redirects USING INDEX redirects_from_idx (from=?)',
      'SEARCH redirects USING INDEX redirects_regex_path_idx (regex_path=?)'
    ]

    it('finds the candidates with searches of the indexes on from and regexPath alone', async () => {
      for (const path of LOOKED_UP_PATHS) {
        const plan = await findSqlitePlan(site.payload, await recordLookup(path))

        expect(plan).toEqual(expect.arrayContaining(['MULTI-INDEX OR', ...LOOKUP_INDEXES]))
        expect(plan.filter((line) => /^(SCAN|SEARCH) redirects\b/.test(line))).toEqual(LOOKUP_INDEXES)
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

      expect(plan.filter((line) => /^(SCAN|SEARCH) redirects\b/.test(line))).toEqual(LOOKUP_INDEXES)
    })
  }

  // Postgres picks a plan by its cost, and on a table this small reads the whole table whatever its
  // indexes, so the test holds that the indexes a lookup and a save read are there.
  if (database === 'postgres') {
    it('keeps the indexes a lookup reads, on from and regexPath, and the one a save reads, on _order', async () => {
      expect(await findPostgresIndexes(site.payload, 'redirects')).toEqual(
        expect.arrayContaining(['redirects(from)', 'redirects(regex_path)', 'redirects(_order)'])
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

  // Every page deleted asks for its suggestions, on the index of suggestions alone.
  it('asks once for the suggestions of a deleted page, and reads none more when it has none', async () => {
    const shed = await publish(site.payload, 'pages', { slug: 'shed', title: 'Shed' })

    const queries = (await site.listQueries(() => remove(site.payload, 'pages', shed))).filter(isRedirects)

    expect(queries.map(describeQuery)).toEqual([`${readOperation} redirects`])
    if (database === 'mongodb') {
      expect(await findMongodbPlan(site.payload, queries[0]!)).toMatchObject({ indexes: ['to.document.value_1'] })
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
