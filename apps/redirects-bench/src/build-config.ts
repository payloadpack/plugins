import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { redirectsPlugin, type WinOverDocuments } from '@payloadpack/redirects'
import { buildConfig, type Access, type DatabaseAdapterObj } from 'payload'

export const DATABASES = ['mongodb', 'postgres', 'sqlite'] as const

export type Database = (typeof DATABASES)[number]

type BuildConfigArgs = {
  // Only the bench's own Payload instance creates the schema: Postgres and SQLite tables with push,
  // MongoDB indexes with ensureIndexes. The servers find them there.
  createSchema?: boolean
  database: Database
  url: string
  winOverDocuments?: WinOverDocuments
}

// A lookup reads a redirect's target as a visitor, so a page that isn't published sends nobody.
const publishedOrAdminUser: Access = ({ req: { payload, user } }) =>
  user?.collection === payload.config.admin.user || { _status: { equals: 'published' } }

function buildAdapter({ createSchema = false, database, url }: BuildConfigArgs): DatabaseAdapterObj {
  if (database === 'mongodb') return mongooseAdapter({ ensureIndexes: createSchema, url })
  if (database === 'postgres') return postgresAdapter({ pool: { connectionString: url }, push: createSchema })
  return sqliteAdapter({ client: { url }, push: createSchema })
}

export const buildBenchConfig = (args: BuildConfigArgs) =>
  buildConfig({
    collections: [
      { slug: 'users', auth: true, fields: [] },
      {
        slug: 'pages',
        access: { read: publishedOrAdminUser },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'path', type: 'text', index: true }
        ],
        versions: { drafts: true }
      }
    ],
    db: buildAdapter(args),
    logger: { options: { level: 'error' } },
    plugins: [
      redirectsPlugin({
        buildDocumentPath: ({ document }) => document.path,
        collections: ['pages'],
        documentSelect: { path: true },
        winOverDocuments: args.winOverDocuments
      })
    ],
    secret: 'redirects-bench',
    telemetry: false
  })
