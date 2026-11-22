import { pathPlugin } from '@payloadpack/path'
import { fileURLToPath } from 'node:url'
import { buildConfig, getPayload, type CollectionSlug, type Config } from 'payload'
import { afterAll, it } from 'vitest'

import { mapInChunks, startQueryReport, WARM_UP_RUNS } from '../../../scripts/query-report/measure.js'
import { buildAdapter, recordQueries } from './support/adapters.js'
import { createRedirect, publish, publishChange, toDocument, toUrl } from './support/documents.js'
import { TESTED_DATABASES, type DatabaseName } from './support/setups.js'

// What a pull request costs the database: the query report. Run it with scripts/query-report/vitest.config.ts.

type Version = typeof import('../src/index.js')

const PAGES = 'pages' as CollectionSlug
const LOOKUP_RUNS = 201
const SAVE_RUNS = 51

// Each with where it sends visitors, which every run checks, so a lookup that finds nothing measures nothing.
const LOOKUPS = [
  ['`findRedirect`: an exact path', '/old-1234', '/new-1234'],
  ['`findRedirect`: a regex', '/archive-560/2024/spring', '/moved-560/2024/spring'],
  ['`findRedirect`: a redirect to a page', '/to-page-561', '/page-61'],
  ['`findRedirect`: a path no redirect covers', '/nothing/here', undefined]
] as const

let siteCount = 0

// A site on a database of its own with one version of the plugin, the base's or this pull request's,
// holding 10,000 redirects saved through that version: every tenth a regex, every tenth one to a page.
async function startSite(version: Version, database: DatabaseName) {
  const name = `query_report_${process.pid}_${siteCount++}`
  const { listQueries, record } = recordQueries()
  const config = await buildConfig({
    collections: [
      { slug: 'pages', access: { read: () => true }, fields: [{ name: 'title', type: 'text' }], versions: { drafts: true } }
    ],
    // With transactions on MongoDB and Postgres and without on SQLite, as a site runs each by default.
    db: buildAdapter(database, name, record, database !== 'sqlite') as Config['db'],
    logger: { options: { level: 'fatal' } },
    plugins: [
      pathPlugin({ collections: ['pages'], onPathsChanged: (args) => version.suggestRedirects(args) }),
      version.redirectsPlugin({
        buildDocumentPath: ({ document }) => document.path,
        collections: ['pages'],
        documentSelect: { path: true }
      })
    ],
    secret: 'query-report',
    telemetry: false
  })
  // Payload skips the schema push for a config like the last one it pushed in this process, which would
  // leave a new database without tables.
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  const payload = await getPayload({ config, key: name })
  const pages = await mapInChunks(Array.from({ length: 100 }), (_, index) =>
    publish(payload, PAGES, { slug: `page-${index}`, title: `page-${index}` })
  )
  await mapInChunks(Array.from({ length: 10_000 }), (_, index) =>
    createRedirect(
      payload,
      index % 10 === 0
        ? { from: `/archive-${index}/(.*)`, match: 'regex', to: toUrl(`/moved-${index}/$1`) }
        : index % 10 === 1
          ? { from: `/to-page-${index}`, to: toDocument('pages', pages[index % 100]!) }
          : { from: `/old-${index}`, to: toUrl(`/new-${index}`) }
    )
  )
  // The pages the moves publish at a new slug, one for each run.
  const movedPages = await mapInChunks(Array.from({ length: WARM_UP_RUNS + SAVE_RUNS }), (_, index) =>
    publish(payload, PAGES, { slug: `moving-${index}`, title: `moving-${index}` })
  )
  return { listQueries, movedPages, payload, version }
}

const queryReport = await startQueryReport({
  databases: TESTED_DATABASES,
  name: 'redirects',
  packageDirectory: fileURLToPath(new URL('..', import.meta.url)),
  pullRequestVersion: await import('../src/index.js'),
  startSite
})

afterAll(() => queryReport.finish())

it.each(TESTED_DATABASES)('measures %s', (database) =>
  queryReport.measureDatabase(database, async (measure) => {
    for (const [operation, path, destination] of LOOKUPS) {
      await measure(operation, LOOKUP_RUNS, async ({ payload, version }) => {
        const { foundRedirect } = await version.findRedirect({ path, payload })
        if (foundRedirect?.destination !== destination)
          throw new Error(`${path} sent visitors to ${foundRedirect?.destination ?? 'nobody'}`)
      })
    }
    await measure('Create a redirect', SAVE_RUNS, ({ payload }, index) =>
      createRedirect(payload, { from: `/created-${index}`, to: toUrl('/created') })
    )
    await measure('Move a page, which suggests a redirect', SAVE_RUNS, ({ movedPages, payload }, index) =>
      publishChange(payload, PAGES, movedPages[index]!, { slug: `moved-${index}` })
    )
  })
)
