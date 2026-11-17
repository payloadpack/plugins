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
import { pathPlugin, type PathPluginOptions, type PathsChange } from '../../src/index.js'
import { defaultSlugify } from '../../src/plugin/slugify.js'
import { buildAdapter, recordQueries } from './adapters.js'
import { LOCALES, SETUPS, type Setup } from './setups.js'

const RESERVED_SEGMENTS = {
  anyDepth: { '-': 'starts the page and filters of a listing' },
  root: { admin: 'the CMS', api: "the CMS's API" }
}

// The collections of every test config, each one given to the plugin unless a test says otherwise.
const STANDARD_COLLECTIONS = ['pages', 'posts', 'notices']

let databaseCount = 0

// The fields the plugin adds to a collection, for one that holds them without the plugin.
export const pathFields = (collection: CollectionSlug, localized: boolean): Field[] => [
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

// A collection without drafts, where every save publishes. Its title is required, so on Postgres and
// SQLite a locale's row can't exist before the document is saved in that locale.
const notices = (localized: boolean, fields: Field[]): CollectionConfig => ({
  slug: 'notices',
  admin: { useAsTitle: 'title' },
  fields: [{ name: 'title', type: 'text', localized, required: true }, ...fields]
})

export type TestPayload = {
  changes: PathsChange[]
  countQueries: ReturnType<typeof recordQueries>['countQueries']
  payload: Payload
}

type StartOptions = {
  // MongoDB only: each document of a bulk operation gets a transaction of its own.
  bulkOperationsSingleTransaction?: boolean
  collections?: CollectionConfig[]
  // The localization of a localized setup, in place of the two locales falling back to English.
  localization?: Exclude<Config['localization'], false | undefined>
  options?: Partial<PathPluginOptions>
  // Payload's own routes, in place of /admin and /api.
  routes?: Config['routes']
  transactions?: boolean
  // The benchmark seeds a database without the plugin and opens it again with it, by its name, which
  // startPayload returns. Without the plugin, the standard collections hold its fields and none of
  // its hooks, as does a standard collection the plugin isn't given.
  database?: string
  plugin?: boolean
}

export async function startPayload(
  setup: Setup,
  {
    bulkOperationsSingleTransaction = false,
    collections = [],
    database,
    localization = { defaultLocale: 'en', fallback: true, locales: LOCALES },
    options = {},
    plugin = true,
    routes,
    transactions = true
  }: StartOptions = {}
): Promise<TestPayload & { database: string }> {
  const name = database ?? `path_${process.pid}_${databaseCount++}`
  const changes: PathsChange[] = []
  const { countQueries, record } = recordQueries()
  const pluginOptions: PathPluginOptions = {
    collections: STANDARD_COLLECTIONS,
    onPathsChanged: (change) => void changes.push(change),
    reservedSegments: RESERVED_SEGMENTS,
    ...options
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
    db: buildAdapter(setup.database, name, record, { bulkOperationsSingleTransaction, transactions }) as Config['db'],
    localization: setup.localized ? localization : undefined,
    // A test sees each refusal as the error it throws, so Payload's own logging of it is noise.
    logger: { options: { level: 'fatal' } },
    plugins: plugin ? [pathPlugin(pluginOptions)] : [],
    routes,
    secret: 'path-tests',
    telemetry: false
  })
  const payload = await getPayload({ config, key: `${name}_${plugin ? 'plugin' : 'fields'}` })
  return { changes, countQueries, database: name, payload }
}

/**
 * A describe block per setup, each booting Payload once before its tests and destroying it after
 * them. The body gets the booted instance, filled in before the first test runs.
 *
 * The tests of one block share one database, so slugs must be unique within a block: a test that
 * reuses another test's slug is refused with "already at this path".
 */
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
