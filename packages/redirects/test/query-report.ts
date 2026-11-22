import { pathPlugin } from '@payloadpack/path'
import { fileURLToPath } from 'node:url'
import { buildConfig, getPayload, type CollectionSlug, type Config, type Payload } from 'payload'
import { afterAll, it } from 'vitest'

import {
  importBaseSource,
  mapInChunks,
  measureInTurns,
  removeBaseSource,
  WARM_UP_RUNS,
  writeReport,
  type PackageReport
} from '../../../scripts/query-report/report.js'
import { buildAdapter, recordQueries } from './support/adapters.js'
import { TESTED_DATABASES, type DatabaseName } from './support/setups.js'

// What a pull request costs the database: the query report. Run it with test/query-report.config.ts.

type Version = typeof import('../src/index.js')
type Site = Awaited<ReturnType<typeof startSite>>

const PACKAGE_DIRECTORY = fileURLToPath(new URL('..', import.meta.url))
const LABELS: Record<DatabaseName, string> = { mongodb: 'MongoDB', postgres: 'Postgres', sqlite: 'SQLite' }
const PAGES = 'pages' as CollectionSlug
const REDIRECTS = 'redirects' as CollectionSlug
const LOOKUP_RUNS = 201
const SAVE_RUNS = 51

// Each with where it sends visitors, which every run checks, so a lookup that finds nothing measures nothing.
const LOOKUPS = [
  ['`findRedirect`: an exact path', '/old-1234', '/new-1234'],
  ['`findRedirect`: a regex', '/archive-560/2024/spring', '/moved-560/2024/spring'],
  ['`findRedirect`: a redirect to a page', '/to-page-561', '/page-61'],
  ['`findRedirect`: a path no redirect covers', '/nothing/here', undefined]
] as const

const toUrl = (url: string) => ({ type: 'url', url })

const publish = (payload: Payload, slug: string) =>
  payload.create({ collection: PAGES, data: { _status: 'published', slug, title: slug }, depth: 0, overrideAccess: true })

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
  const pages = await mapInChunks(Array.from({ length: 100 }), async (_, index) => (await publish(payload, `page-${index}`)).id)
  await mapInChunks(Array.from({ length: 10_000 }), (_, index) =>
    payload.create({
      collection: REDIRECTS,
      data:
        index % 10 === 0
          ? { from: `/archive-${index}/(.*)`, match: 'regex', to: toUrl(`/moved-${index}/$1`) }
          : index % 10 === 1
            ? {
                from: `/to-page-${index}`,
                to: { document: { relationTo: 'pages', value: pages[index % 100] }, type: 'document' }
              }
            : { from: `/old-${index}`, to: toUrl(`/new-${index}`) },
      depth: 0,
      overrideAccess: true
    })
  )
  // The pages the moves publish at a new slug, one for each run.
  const moving = await mapInChunks(
    Array.from({ length: WARM_UP_RUNS + SAVE_RUNS }),
    async (_, index) => (await publish(payload, `moving-${index}`)).id
  )
  return { listQueries, moving, payload, version }
}

const report: PackageReport = { base: [], name: 'redirects', pullRequest: [] }
const pullRequestVersion: Version = await import('../src/index.js')
const baseVersion = await importBaseSource<Version>(PACKAGE_DIRECTORY).catch((error: unknown) => {
  report.baseError = String(error)
  return undefined
})
// A report with a database missing would read as complete, so a run that stops writes none.
let measuredDatabases = 0

afterAll(async () => {
  await removeBaseSource(PACKAGE_DIRECTORY)
  if (measuredDatabases === TESTED_DATABASES.length) await writeReport(report)
})

it.each(TESTED_DATABASES)('measures %s', async (database) => {
  const pullRequest = await startSite(pullRequestVersion, database)
  const base = baseVersion && (await startSite(baseVersion, database))
  const measure = (operation: string, runs: number, run: (site: Site, index: number) => Promise<unknown>) =>
    measureInTurns(report, LABELS[database], operation, runs, {
      base: base && { listQueries: base.listQueries, run: (index) => run(base, index) },
      pullRequest: { listQueries: pullRequest.listQueries, run: (index) => run(pullRequest, index) }
    })

  for (const [operation, path, destination] of LOOKUPS) {
    await measure(operation, LOOKUP_RUNS, async ({ payload, version }) => {
      const { foundRedirect } = await version.findRedirect({ path, payload })
      if (foundRedirect?.destination !== destination)
        throw new Error(`${path} sent visitors to ${foundRedirect?.destination ?? 'nobody'}`)
    })
  }
  await measure('Create a redirect', SAVE_RUNS, ({ payload }, index) =>
    payload.create({
      collection: REDIRECTS,
      data: { from: `/created-${index}`, to: toUrl('/created') },
      depth: 0,
      overrideAccess: true
    })
  )
  await measure('Move a page, which suggests a redirect', SAVE_RUNS, ({ moving, payload }, index) =>
    payload.update({
      collection: PAGES,
      data: { _status: 'published', slug: `moved-${index}` },
      depth: 0,
      id: moving[index]!,
      overrideAccess: true
    })
  )

  await pullRequest.payload.destroy()
  await base?.payload.destroy()
  measuredDatabases++
})
