import {
  buildConfig,
  getPayload,
  type CollectionConfig,
  type CollectionSlug,
  type Config,
  type Field,
  type Payload
} from 'payload'
import { afterAll, beforeAll, describe } from 'vitest'

import { ancestorsField } from '../../src/fields/ancestors.js'
import { parentField } from '../../src/fields/parent.js'
import { pathField } from '../../src/fields/path.js'
import { slugField } from '../../src/fields/slug.js'
import { pathPlugin, type ChangedPath, type PathCollection, type PathPluginOptions } from '../../src/index.js'
import { defaultSlugify } from '../../src/plugin/slugify.js'
import { buildAdapter, recordQueries } from './adapters.js'
import { LOCALES, SETUPS, type Setup } from './setups.js'

const RESERVED_SEGMENTS = {
  anyDepth: { '-': 'starts the page and filters of a listing' },
  root: { admin: 'the CMS', api: "the CMS's API" }
}

const STANDARD_COLLECTIONS = ['pages', 'posts', 'notices']

let databaseCount = 0
let startCount = 0

const LOCALIZATION = { defaultLocale: 'en', fallback: true, locales: LOCALES }

// A standard collection the plugin isn't given holds its fields all the same, with none of its hooks.
const pathFields = (collection: CollectionSlug, localized: boolean): Field[] => [
  parentField(collection),
  slugField({ localized, slugify: defaultSlugify, useAsTitle: 'title' }),
  pathField(localized),
  ancestorsField(collection)
]

export const titled = (slug: string, localized: boolean, fields: Field[] = []): CollectionConfig => ({
  slug,
  admin: { useAsTitle: 'title' },
  fields: [{ name: 'title', type: 'text', localized }, ...fields],
  versions: { drafts: true }
})

// Its title is required, so on Postgres and SQLite a locale's row can't exist before the document is
// saved in that locale.
const notices = (localized: boolean, fields: Field[]): CollectionConfig => ({
  slug: 'notices',
  admin: { useAsTitle: 'title' },
  fields: [{ name: 'title', type: 'text', localized, required: true }, ...fields]
})

export type TestPayload = {
  // One entry per call of onPathsChanged, in order.
  changes: ChangedPath[][]
  countQueries: ReturnType<typeof recordQueries>['countQueries']
  payload: Payload
}

type StartOptions = {
  // MongoDB only: each document of a bulk operation gets a transaction of its own.
  bulkOperationsSingleTransaction?: boolean
  collections?: CollectionConfig[]
  // Postgres and SQLite only: a uuid for the id of every collection without an id field of its own.
  idType?: 'uuid'
  // In a setup without localization, a site that has locales and localizes nothing of its own.
  localization?: Exclude<Config['localization'], false | undefined>
  notLocalized?: CollectionSlug[]
  options?: Partial<PathPluginOptions>
  routes?: Config['routes']
  transactions?: boolean
  // The benchmark seeds a database without the plugin and opens it again with it, by the name
  // startPayload returns.
  database?: string
  plugin?: boolean
}

export async function startPayload(
  setup: Setup,
  {
    bulkOperationsSingleTransaction = false,
    collections = [],
    database,
    idType,
    localization,
    notLocalized = [],
    options = {},
    plugin = true,
    routes,
    transactions = true
  }: StartOptions = {}
): Promise<TestPayload & { database: string }> {
  const name = database ?? `path_${process.pid}_${databaseCount++}`
  const changes: ChangedPath[][] = []
  const { countQueries, record } = recordQueries()
  const withLocalized = (collection: PathCollection): PathCollection => {
    const given = typeof collection === 'string' ? { slug: collection } : collection
    return setup.localized && !notLocalized.includes(given.slug) ? { ...given, localized: true } : collection
  }
  const pluginOptions: PathPluginOptions = {
    onPathsChanged: ({ changedPaths }) => void changes.push(changedPaths),
    reservedSegments: RESERVED_SEGMENTS,
    ...options,
    collections: (options.collections ?? STANDARD_COLLECTIONS).map(withLocalized)
  }
  const given = plugin
    ? pluginOptions.collections.map((collection) => (typeof collection === 'string' ? collection : collection.slug))
    : []
  const ownFields = (collection: CollectionSlug) => (given.includes(collection) ? [] : pathFields(collection, setup.localized))
  const config = await buildConfig({
    collections: [
      titled('pages', setup.localized, ownFields('pages')),
      titled('posts', setup.localized, ownFields('posts')),
      notices(setup.localized, ownFields('notices')),
      ...collections
    ],
    db: buildAdapter(setup.database, name, record, { bulkOperationsSingleTransaction, idType, transactions }) as Config['db'],
    localization: localization ?? (setup.localized ? LOCALIZATION : undefined),
    // A test sees each refusal as the error it throws, so Payload's own logging of it is noise.
    logger: { options: { level: 'fatal' } },
    plugins: plugin ? [pathPlugin(pluginOptions)] : [],
    routes,
    secret: 'path-tests',
    telemetry: false
  })
  // Payload skips the schema push of Postgres and SQLite for a config that is the same as the last one
  // it pushed in this process, which would leave a new database without tables. A database opened
  // again has its tables already.
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = String(database === undefined)
  // Payload keeps an instance per key, so each start gets its own, also of a database opened again.
  const payload = await getPayload({ config, key: `${name}_${startCount++}` })
  return { changes, countQueries, database: name, payload }
}

// The tests of one block share one database, so slugs must be unique within a block: a test that
// reuses another test's slug is refused with "already at this path".
export function describeEachSetup(
  label: string,
  { boot = {}, setups = SETUPS }: { boot?: StartOptions | ((setup: Setup) => StartOptions); setups?: Setup[] },
  body: (test: TestPayload, setup: Setup) => void
) {
  describe.each(setups)(label === '' ? '$name' : `$name, ${label}`, (setup) => {
    // Filled in when the block boots, before its first test.
    const test = {} as TestPayload
    beforeAll(async () => {
      const { changes, countQueries, payload } = await startPayload(setup, typeof boot === 'function' ? boot(setup) : boot)
      Object.assign(test, { changes, countQueries, payload })
    })
    afterAll(() => test.payload?.destroy())
    body(test, setup)
  })
}
