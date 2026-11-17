import type { Payload } from 'payload'

import type { Page, Topic } from './payload-types'

export const DEMO_USER = { email: 'demo@payloadpack.com', password: 'demo' }

type SeedDocument = {
  // The documents below it, in its own collection, where that has a parent.
  children?: SeedDocument[]
  draft?: boolean
  slug: string
  summary: string
  // The Swedish slug and title, when the demo runs with localization. A topic has no Swedish slug,
  // because its one slug is the same in every locale.
  sv?: { slug?: string; title: string }
  title: string
}

// The pages: a home page, pages below pages, and the page at /blog, where the posts' base path is.
const PAGES: SeedDocument[] = [
  { slug: 'home', summary: 'The home page answers /.', sv: { title: 'Hem' }, title: 'Home' },
  {
    children: [
      { slug: 'team', summary: 'A page below a page.', sv: { title: 'Teamet' }, title: 'Team' },
      {
        slug: 'our-story',
        summary: 'Another page below it.',
        sv: { slug: 'var-historia', title: 'Vår historia' },
        title: 'Our story'
      }
    ],
    slug: 'about',
    summary: 'Rename this page and everything below it moves along.',
    sv: { slug: 'om-oss', title: 'Om oss' },
    title: 'About'
  },
  {
    slug: 'blog',
    summary: 'The page at /blog. The posts sit below it, at their base path.',
    // No Swedish slug, because a base path is the same in every language.
    sv: { title: 'Blogg' },
    title: 'Blog'
  },
  {
    children: [{ slug: 'api', summary: '/api is reserved at the root only.', title: 'API' }],
    slug: 'docs',
    summary: 'A page that holds a page named like a reserved segment.',
    sv: { title: 'Dokumentation' },
    title: 'Docs'
  },
  { slug: 'pricing', summary: 'A top-level page.', sv: { slug: 'priser', title: 'Priser' }, title: 'Pricing' }
]

// The posts, which have no parent: each one at their base path, /blog, and its slug. One is a draft.
const POSTS: SeedDocument[] = [
  {
    slug: 'hello-world',
    summary: 'The first post, at /blog/hello-world.',
    sv: { slug: 'hej-varlden', title: 'Hej världen' },
    title: 'Hello world'
  },
  { slug: 'release-notes', summary: 'What changed.', sv: { title: 'Versionsnyheter' }, title: 'Release notes' },
  { draft: true, slug: 'coming-soon', summary: 'A draft takes its path too.', title: 'Coming soon' }
]

// The topics, in the tree of Payload's own hierarchy, below their base path, /topics. Their titles
// are translated, and each has one slug and one path for every locale.
const TOPICS: SeedDocument[] = [
  {
    children: [
      {
        slug: 'moving',
        summary: "A topic below a topic. Move it with the button in the header, which is Payload's own.",
        sv: { title: 'Flytta' },
        title: 'Moving'
      }
    ],
    slug: 'editing',
    summary: 'A topic at /topics/editing.',
    sv: { title: 'Redigera' },
    title: 'Editing'
  },
  { slug: 'publishing', summary: 'A top-level topic.', sv: { title: 'Publicera' }, title: 'Publishing' }
]

// The field a collection's documents hold their parent in: the plugin's own for pages, and the one
// of Payload's hierarchy for topics. Posts have none.
const PARENT_FIELDS = { pages: 'parent', posts: undefined, topics: '_h_topics' }

async function seedDocument(
  payload: Payload,
  collection: keyof typeof PARENT_FIELDS,
  document: SeedDocument,
  parent?: Page['id'] | Topic['id']
) {
  const status = document.draft ? 'draft' : 'published'
  const parentField = PARENT_FIELDS[collection]
  const created = await payload.create({
    collection,
    data: {
      _status: status,
      slug: document.slug,
      summary: document.summary,
      title: document.title,
      ...(parentField && parent ? { [parentField]: parent } : {})
    },
    draft: document.draft,
    overrideAccess: true
  })
  if (payload.config.localization && document.sv) {
    await payload.update({
      collection,
      data: { _status: status, ...document.sv },
      draft: document.draft,
      id: created.id,
      locale: 'sv',
      overrideAccess: true
    })
  }
  for (const child of document.children ?? []) await seedDocument(payload, collection, child, created.id)
}

// Seeds an empty database with the demo user and the site, so every run starts from the same place.
export async function seed(payload: Payload) {
  const { totalDocs } = await payload.count({ collection: 'users', overrideAccess: true })
  if (totalDocs > 0) return
  await payload.create({ collection: 'users', data: DEMO_USER, overrideAccess: true })
  for (const document of PAGES) await seedDocument(payload, 'pages', document)
  for (const document of POSTS) await seedDocument(payload, 'posts', document)
  for (const document of TOPICS) await seedDocument(payload, 'topics', document)
}
