import { fileURLToPath } from 'node:url'
import { buildConfig, getPayload, type CollectionSlug, type Config } from 'payload'
import { afterAll, it } from 'vitest'

import { mapInChunks, startQueryReport } from '../../../scripts/query-report/measure.js'
import { buildAdapter, recordQueries } from './support/adapters.js'
import { create, update } from './support/documents.js'
import { TESTED_DATABASES, type DatabaseName } from './support/setups.js'

// What a pull request costs the database: the query report. Run it with scripts/query-report/vitest.config.ts.

type Version = typeof import('../src/index.js')
type Id = number | string
type Site = Awaited<ReturnType<typeof startSite>>

const PAGES = 'pages' as CollectionSlug
const LOOKUP_RUNS = 201
const SAVE_RUNS = 51
const MOVE_RUNS = 21
const DEEP_PATH = Array.from({ length: 10 }, (_, level) => `/level-${level}`).join('')

let siteCount = 0

// A site on a database of its own with one version of the plugin, the base's or this pull request's,
// holding a tree published through that version: 30 sections with 10 pages below each, a line of pages
// 10 levels deep, and a page with 100 pages below it, which the moves publish at a new slug.
async function startSite(version: Version, database: DatabaseName) {
  const name = `query_report_${process.pid}_${siteCount++}`
  const { countQueries, record } = recordQueries()
  const config = await buildConfig({
    collections: [{ slug: 'pages', fields: [{ name: 'title', type: 'text' }], versions: { drafts: true } }],
    // With transactions on MongoDB and Postgres and without on SQLite, as a site runs each by default.
    db: buildAdapter(database, name, record, {
      bulkOperationsSingleTransaction: false,
      transactions: database !== 'sqlite'
    }) as Config['db'],
    logger: { options: { level: 'fatal' } },
    plugins: [version.pathPlugin({ collections: ['pages'] })],
    secret: 'query-report',
    telemetry: false
  })
  // Payload skips the schema push for a config like the last one it pushed in this process, which would
  // leave a new database without tables.
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  const payload = await getPayload({ config, key: name })
  const publishAll = (pages: { parent?: Id; slug: string }[]) =>
    mapInChunks(pages, async ({ parent, slug }) => (await create(payload, PAGES, { parent, slug, title: slug })).id as Id)
  const buildChildPages = (parentIds: Id[], count: number, slug: string) =>
    parentIds.flatMap((parent, parentIndex) =>
      Array.from({ length: count }, (_, index) => ({ parent, slug: `${slug}-${parentIndex}-${index}` }))
    )

  const sectionPageIds = await publishAll(Array.from({ length: 30 }, (_, index) => ({ slug: `section-${index}` })))
  await publishAll(buildChildPages(sectionPageIds, 10, 'page'))
  let deepestPageId: Id | undefined
  for (let level = 0; level < 10; level++) [deepestPageId] = await publishAll([{ parent: deepestPageId, slug: `level-${level}` }])
  const [movedPageId] = await publishAll([{ slug: 'moved' }])
  await publishAll(buildChildPages(await publishAll(buildChildPages([movedPageId!], 10, 'shelf')), 9, 'item'))
  return {
    deepestPageId: deepestPageId!,
    listQueries: countQueries,
    movedPageId: movedPageId!,
    payload,
    sectionPageId: sectionPageIds[3]!,
    version
  }
}

const queryReport = await startQueryReport({
  databases: TESTED_DATABASES,
  name: 'path',
  packageDirectory: fileURLToPath(new URL('..', import.meta.url)),
  pullRequestVersion: await import('../src/index.js'),
  startSite
})

afterAll(() => queryReport.finish())

it.each(TESTED_DATABASES)('measures %s', (database) =>
  queryReport.measureDatabase(database, async (measure) => {
    for (const [operation, path, readExpectedPageId] of [
      ['`findByPath`: a top-level page', '/section-3', (site: Site) => site.sectionPageId],
      ['`findByPath`: a page 10 levels deep', DEEP_PATH, (site: Site) => site.deepestPageId]
    ] as const) {
      await measure(operation, LOOKUP_RUNS, async (site) => {
        const foundByPath = await site.version.findByPath({ path, payload: site.payload })
        if (foundByPath?.document.id !== readExpectedPageId(site))
          throw new Error(`findByPath found ${String(foundByPath?.document.id)} at ${path}`)
      })
    }
    await measure('Publish a page', SAVE_RUNS, ({ payload, sectionPageId }, index) =>
      create(payload, PAGES, { parent: sectionPageId, slug: `new-${index}`, title: 'New' })
    )
    await measure('Move a page with 100 pages below it', MOVE_RUNS, ({ movedPageId, payload }, index) =>
      update(payload, PAGES, movedPageId, { slug: `moved-${index}` })
    )
  })
)
