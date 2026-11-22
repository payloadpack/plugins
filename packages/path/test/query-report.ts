import { fileURLToPath } from 'node:url'
import { buildConfig, getPayload, type CollectionSlug, type Config } from 'payload'
import { afterAll, it } from 'vitest'

import {
  importBaseSource,
  mapInChunks,
  measureInTurns,
  removeBaseSource,
  writeReport,
  type PackageReport
} from '../../../scripts/query-report/report.js'
import { buildAdapter, recordQueries } from './support/adapters.js'
import { create, update } from './support/documents.js'
import { TESTED_DATABASES, type DatabaseName } from './support/setups.js'

// What a pull request costs the database: the query report. Run it with test/query-report.config.ts.

type Version = typeof import('../src/index.js')
type Id = number | string
type Site = Awaited<ReturnType<typeof startSite>>

const PACKAGE_DIRECTORY = fileURLToPath(new URL('..', import.meta.url))
const LABELS: Record<DatabaseName, string> = { mongodb: 'MongoDB', postgres: 'Postgres', sqlite: 'SQLite' }
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
  const below = (parents: Id[], count: number, slug: string) =>
    parents.flatMap((parent, parentIndex) =>
      Array.from({ length: count }, (_, index) => ({ parent, slug: `${slug}-${parentIndex}-${index}` }))
    )

  const sections = await publishAll(Array.from({ length: 30 }, (_, index) => ({ slug: `section-${index}` })))
  await publishAll(below(sections, 10, 'page'))
  let deepest: Id | undefined
  for (let level = 0; level < 10; level++) [deepest] = await publishAll([{ parent: deepest, slug: `level-${level}` }])
  const [moved] = await publishAll([{ slug: 'moved' }])
  await publishAll(below(await publishAll(below([moved!], 10, 'shelf')), 9, 'item'))
  return { deepest: deepest!, listQueries: countQueries, moved: moved!, payload, section: sections[3]!, version }
}

const report: PackageReport = { base: [], name: 'path', pullRequest: [] }
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

  for (const [operation, path, foundId] of [
    ['`findByPath`: a top-level page', '/section-3', (site: Site) => site.section],
    ['`findByPath`: a page 10 levels deep', DEEP_PATH, (site: Site) => site.deepest]
  ] as const) {
    await measure(operation, LOOKUP_RUNS, async (site) => {
      const found = await site.version.findByPath({ path, payload: site.payload })
      if (found?.document.id !== foundId(site)) throw new Error(`findByPath found ${String(found?.document.id)} at ${path}`)
    })
  }
  await measure('Publish a page', SAVE_RUNS, ({ payload, section }, index) =>
    create(payload, PAGES, { parent: section, slug: `new-${index}`, title: 'New' })
  )
  await measure('Move a page with 100 pages below it', MOVE_RUNS, ({ moved, payload }, index) =>
    update(payload, PAGES, moved, { slug: `moved-${index}` })
  )

  await pullRequest.payload.destroy()
  await base?.payload.destroy()
  measuredDatabases++
})
