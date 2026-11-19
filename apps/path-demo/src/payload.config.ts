import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { pathPlugin } from '@payloadpack/path'
import path from 'path'
import { buildConfig, type CollectionConfig } from 'payload'
import { fileURLToPath } from 'url'

import { DEMO_USER, seed } from './seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// The demo runs without localization, or with English and Swedish when DEMO_LOCALIZED is true.
const localized = process.env.DEMO_LOCALIZED === 'true'

const page = (slug: string, singular: string, plural: string): CollectionConfig => ({
  slug,
  admin: { defaultColumns: ['title', 'path', '_status', 'updatedAt'], useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text', localized, required: true },
    { name: 'summary', type: 'textarea', localized }
  ],
  labels: { plural, singular },
  versions: { drafts: { autosave: true } }
})

export default buildConfig({
  admin: {
    autoLogin: process.env.NODE_ENV === 'development' ? { ...DEMO_USER, prefillOnly: true } : false,
    importMap: { baseDir: path.resolve(dirname) },
    user: 'users'
  },
  collections: [
    { slug: 'users', admin: { useAsTitle: 'email' }, auth: true, fields: [] },
    page('pages', 'Page', 'Pages'),
    page('posts', 'Post', 'Posts'),
    // Payload's own hierarchy gives a topic its parent, which an editor picks with the button in the header.
    { ...page('topics', 'Topic', 'Topics'), hierarchy: true }
  ],
  // scripts/with-database.ts names the database; a build connects to none. The indexes are built
  // before Payload's first transaction, which MongoDB refuses while they change.
  db: mongooseAdapter({
    // Payload's ensureIndexes doesn't wait for the index builds mongoose starts itself, which the seed's first save would meet.
    afterOpenConnection: async ({ collections, versions }) => {
      await Promise.all([...Object.values(collections), ...Object.values(versions)].map((model) => model.init()))
    },
    ensureIndexes: true,
    url: process.env.DATABASE_URI || false
  }),
  localization: localized ? { defaultLocale: 'en', fallback: true, locales: ['en', 'sv'] } : undefined,
  onInit: seed,
  plugins: [
    pathPlugin({
      // A page sits below a page by the plugin's own parent, a post has no parent, and a topic sits
      // below a topic by the parent of Payload's hierarchy. With localization, a page and a post have
      // a slug and a path per locale, and a topic has one slug and one path, the same in every locale.
      collections: [
        { localized: true, slug: 'pages' },
        { basePath: '/blog', localized: true, parent: false, slug: 'posts' },
        { basePath: '/topics', slug: 'topics' }
      ],
      reservedSegments: {
        anyDepth: { '-': 'starts the page and filters of a listing' },
        root: { admin: 'the CMS', api: "the CMS's API" }
      }
    })
  ],
  secret: process.env.PAYLOAD_SECRET || 'demo-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') }
})
