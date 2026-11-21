import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { pathPlugin } from '@payloadpack/path'
import { redirectsPlugin, suggestRedirects } from '@payloadpack/redirects'
import path from 'path'
import { buildConfig, type Access, type CollectionConfig } from 'payload'
import { fileURLToPath } from 'url'

import { DEMO_USER, seed } from './seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// A lookup reads a redirect's target as a visitor, so a page that isn't published sends nobody.
const publishedOrAdminUser: Access = ({ req: { payload, user } }) =>
  user?.collection === payload.config.admin.user || { _status: { equals: 'published' } }

const buildPublishableCollection = (slug: string, singular: string, plural: string): CollectionConfig => ({
  slug,
  access: { read: publishedOrAdminUser },
  admin: { defaultColumns: ['title', 'path', '_status', 'updatedAt'], useAsTitle: 'title' },
  fields: [{ name: 'title', type: 'text', required: true }],
  labels: { plural, singular },
  versions: { drafts: true }
})

export default buildConfig({
  admin: {
    autoLogin: process.env.NODE_ENV === 'development' ? { ...DEMO_USER, prefillOnly: true } : false,
    importMap: { baseDir: path.resolve(dirname) },
    user: 'users'
  },
  collections: [
    { slug: 'users', admin: { useAsTitle: 'email' }, auth: true, fields: [] },
    buildPublishableCollection('pages', 'Page', 'Pages'),
    buildPublishableCollection('news', 'News item', 'News')
  ],
  // scripts/with-database.ts names the database; a build connects to none.
  db: mongooseAdapter({
    // Only for this demo: an app that uses the plugin needs neither option. Every run of the demo
    // starts on a fresh database that its seed writes to at once, in transactions, which MongoDB
    // refuses while mongoose still builds the indexes it starts on connect. Payload's ensureIndexes
    // doesn't wait for those builds, so the seed waits for each model's init.
    afterOpenConnection: async ({ collections, versions }) => {
      await Promise.all([...Object.values(collections), ...Object.values(versions)].map((model) => model.init()))
    },
    ensureIndexes: true,
    url: process.env.DATABASE_URI || false
  }),
  onInit: seed,
  plugins: [
    pathPlugin({
      // A page sits below a page, and a news item has no parent: each one at /news and its slug.
      collections: ['pages', { basePath: '/news', parent: false, slug: 'news' }],
      // Every move suggests a redirect from the old path, and every path below it, to the document,
      // which an editor turns on with a yes on the moved page.
      onPathsChanged: suggestRedirects
    }),
    // A redirect sends visitors to a page or a news item, at the path pathPlugin() keeps on it.
    redirectsPlugin({
      buildDocumentPath: ({ document }) => document.path,
      collections: ['pages', 'news'],
      documentSelect: { path: true }
    })
  ],
  secret: process.env.PAYLOAD_SECRET || 'demo-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') }
})
