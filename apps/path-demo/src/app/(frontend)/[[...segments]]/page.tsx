import config from '@payload-config'
import { findByPath } from '@payloadpack/path'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ segments?: string[] }>
  searchParams: Promise<{ draft?: string; locale?: 'en' | 'sv' }>
}

export default async function SitePage({ params, searchParams }: Props) {
  const { segments = [] } = await params
  const { draft, locale } = await searchParams
  const payload = await getPayload({ config })
  const path = `/${segments.join('/')}`

  // Without `collections`, TypeScript narrows `found` to the collections with paths (`pages` | `posts` | `topics`).
  // Pass `collections: ['pages', 'posts']` to narrow further.
  const found = await findByPath({
    depth: 1,
    draft: draft === 'true',
    locale,
    path,
    paths: true,
    payload,
    populate: { pages: { path: true, title: true }, topics: { path: true, title: true } }
  })

  if (!found) notFound()

  switch (found.collection) {
    case 'pages': {
      const parent = typeof found.document.parent === 'object' ? found.document.parent : null
      return (
        <main>
          <p>Collection: pages</p>
          <h1>{found.document.title}</h1>
          {found.document.summary && <p>{found.document.summary}</p>}
          {parent && <p>Parent: {parent.title}</p>}
          <pre>{JSON.stringify({ path: found.document.path, paths: found.paths }, null, 2)}</pre>
        </main>
      )
    }
    case 'posts':
      return (
        <main>
          <p>Collection: posts</p>
          <h1>{found.document.title}</h1>
          {found.document.summary && <p>{found.document.summary}</p>}
          <pre>{JSON.stringify({ path: found.document.path, paths: found.paths }, null, 2)}</pre>
        </main>
      )
    case 'topics': {
      const parent = typeof found.document._h_topics === 'object' ? found.document._h_topics : null
      return (
        <main>
          <p>Collection: topics</p>
          <h1>{found.document.title}</h1>
          {found.document.summary && <p>{found.document.summary}</p>}
          {parent && <p>Parent topic: {parent.title}</p>}
          <pre>{JSON.stringify({ path: found.document.path, paths: found.paths }, null, 2)}</pre>
        </main>
      )
    }
  }
}
