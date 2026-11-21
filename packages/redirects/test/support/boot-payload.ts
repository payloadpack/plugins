import { pathPlugin, type ChangedPath } from '@payloadpack/path'
import { buildConfig, getPayload, type Access, type CollectionConfig, type Config, type Payload } from 'payload'
import { afterAll, beforeAll, describe } from 'vitest'

import { redirectsPlugin, suggestRedirects, type RedirectsPluginOptions } from '../../src/index.js'
import { buildAdapter, recordQueries, type Query } from './adapters.js'
import { SETUPS, type Setup } from './setups.js'

const LOCALES = ['en', 'sv']

const publishedOrAdminUser: Access = ({ req: { payload, user } }) =>
  user?.collection === payload.config.admin.user || { _status: { equals: 'published' } }

// What a test adds to the pages collection: the labels a notice names a page by, or hooks of its own.
type PagesConfig = Pick<CollectionConfig, 'hooks' | 'labels'>

const buildPublishableCollection = (slug: string, localized: boolean, { hooks, labels }: PagesConfig = {}): CollectionConfig => ({
  slug,
  access: { read: publishedOrAdminUser },
  admin: { useAsTitle: 'title' },
  fields: [{ name: 'title', type: 'text', localized }],
  hooks,
  labels,
  trash: true,
  versions: { drafts: true }
})

export type Site = {
  // One entry per call of onPathsChanged, in order.
  changes: ChangedPath[][]
  listQueries: (work: () => Promise<unknown>) => Promise<Query[]>
  payload: Payload
}

type SiteOptions = {
  localized?: boolean
  pages?: PagesConfig
  // Over the redirects to pages and news at the path @payloadpack/path keeps.
  redirects?: Partial<RedirectsPluginOptions>
}

let databaseCount = 0
let startCount = 0

async function startSite(
  { database, transactions }: Setup,
  { localized = false, pages, redirects = {} }: SiteOptions
): Promise<Site> {
  const name = `redirects_${process.pid}_${databaseCount++}`
  const changes: ChangedPath[][] = []
  const { listQueries, record } = recordQueries()
  const config = await buildConfig({
    collections: [
      { slug: 'users', auth: true, fields: [] },
      // Users who sign in to the site but not to the admin, such as a shop's customers.
      { slug: 'members', auth: true, fields: [] },
      buildPublishableCollection('pages', localized, pages),
      buildPublishableCollection('news', localized)
    ],
    db: buildAdapter(database, name, record, transactions) as Config['db'],
    localization: localized ? { defaultLocale: 'en', fallback: true, locales: LOCALES } : undefined,
    // A test sees each refusal as the error it throws, so Payload's own logging of it is noise.
    logger: { options: { level: 'fatal' } },
    plugins: [
      pathPlugin({
        collections: [
          { localized: localized || undefined, slug: 'pages' },
          { basePath: '/news', parent: false, slug: 'news' }
        ],
        onPathsChanged: async (args) => {
          changes.push(args.changedPaths)
          await suggestRedirects(args)
        }
      }),
      redirectsPlugin({
        buildDocumentPath: ({ document }) => document.path,
        collections: ['pages', 'news'],
        documentSelect: { path: true },
        ...redirects
      })
    ],
    secret: 'redirects-tests',
    telemetry: false
  })
  // Payload skips the schema push of Postgres and SQLite for a config that is the same as the last one
  // it pushed in this process, which would leave a new database without tables.
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  // Payload keeps an instance per key, so each start gets its own.
  const payload = await getPayload({ config, key: `${name}_${startCount++}` })
  return { changes, listQueries, payload }
}

// Once on each setup the tests run on. The tests of one block share one site, so paths must be
// unique within a block.
export function describeSite(label: string, options: SiteOptions, body: (site: Site, setup: Setup) => void) {
  describe.each(SETUPS)(`$name, ${label}`, (setup) => {
    // Filled in when the block starts, before its first test.
    const site = {} as Site
    beforeAll(async () => {
      Object.assign(site, await startSite(setup, options))
    })
    afterAll(() => site.payload?.destroy())
    body(site, setup)
  })
}
