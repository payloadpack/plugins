import type { CollectionConfig, Config, Field, Payload, WhereField } from 'payload'

import { findByPath } from '../src/index.js'
import type { Id } from '../src/paths/place.js'
import { titled } from '../test/support/boot-payload.js'

/**
 * The other ways a site finds a document by its URL and moves a branch, each on its own copy of the
 * benchmark's pages: Payload's nested-docs plugin as its docs install it, and pages with only a slug
 * and a parent, walked one slug at a time.
 */
export const NESTED_PAGES = 'nested-pages'
export const PLAIN_PAGES = 'plain-pages'

export const METHODS = ['path', 'nested-docs', 'slug-walk'] as const
export type Method = (typeof METHODS)[number]

export const METHOD_LABELS: Record<Method, string> = {
  'nested-docs': 'nested docs',
  path: 'path',
  'slug-walk': 'slug by slug'
}

type Found = { id: Id } | null

export type Breadcrumb = { doc?: Id; label: string; url: string }

const slugField: Field = { name: 'slug', type: 'text' }

// The URL each breadcrumb gets, as the nested-docs docs write it: the slugs from the top down.
const generateURL = (docs: Record<string, unknown>[]) => docs.reduce<string>((url, doc) => `${url}/${String(doc.slug)}`, '')

/**
 * The copies' collections. Nested docs adds its parent and breadcrumbs fields and its hooks, with no
 * index of its own: seeding opens it with the hooks off, as the benchmark seeds path's fields. The
 * plain pages hold the index on slug and parent that a site walking them would add.
 *
 * Nested docs is loaded here, so a run without the comparison never loads it.
 */
export async function comparedCollections({ hooks }: { hooks: boolean }): Promise<CollectionConfig[]> {
  const { nestedDocsPlugin } = await import('@payloadcms/plugin-nested-docs')
  const nestedPlugin = nestedDocsPlugin({ collections: [NESTED_PAGES], generateURL })
  const { collections = [] } = await nestedPlugin({ collections: [titled(NESTED_PAGES, false, [slugField])] } as Config)
  const nestedPages = collections[0]!
  const plainPages: CollectionConfig = {
    ...titled(PLAIN_PAGES, false, [slugField, { name: 'parent', type: 'relationship', relationTo: PLAIN_PAGES }]),
    indexes: [{ fields: ['slug', 'parent'] }]
  }
  return [hooks ? nestedPages : { ...nestedPages, hooks: {} }, plainPages]
}

/**
 * Nested docs has no lookup by URL. A page's breadcrumbs hold the URLs of the pages above it too, so
 * a query on breadcrumbs.url also matches every page below. The slug narrows that to the page, and
 * the match whose last breadcrumb is the path is the one.
 */
async function findWithNestedDocs(payload: Payload, path: string): Promise<Found> {
  const { docs } = await payload.find({
    collection: NESTED_PAGES,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    where: {
      _status: { equals: 'published' },
      'breadcrumbs.url': { equals: path },
      slug: { equals: path.slice(path.lastIndexOf('/') + 1) }
    }
  })
  return (docs as { breadcrumbs?: Breadcrumb[]; id: Id }[]).find(({ breadcrumbs }) => breadcrumbs?.at(-1)?.url === path) ?? null
}

// Without a plugin: one query per slug, each by the slug and the page found before it.
async function walkSlugs(payload: Payload, path: string): Promise<Found> {
  let found: Found = null
  for (const slug of path.split('/').slice(1)) {
    const parent: WhereField = found ? { equals: found.id } : { exists: false }
    const { docs }: { docs: { id: Id }[] } = await payload.find({
      collection: PLAIN_PAGES,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      pagination: false,
      where: { _status: { equals: 'published' }, parent, slug: { equals: slug } }
    })
    found = docs[0] ?? null
    if (!found) return null
  }
  return found
}

export const LOOKUP_METHODS: Record<Method, (payload: Payload, path: string) => Promise<Found>> = {
  'nested-docs': findWithNestedDocs,
  path: async (payload, path) => {
    const found = await findByPath({ path, payload })
    return found && { id: found.document.id }
  },
  'slug-walk': walkSlugs
}

export const METHOD_COLLECTIONS: Record<Method, 'pages' | typeof NESTED_PAGES | typeof PLAIN_PAGES> = {
  'nested-docs': NESTED_PAGES,
  path: 'pages',
  'slug-walk': PLAIN_PAGES
}
