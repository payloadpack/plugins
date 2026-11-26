import config from '@payload-config'
import { findByPath } from '@payloadpack/path'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import type { Page } from '../../../payload-types'

export const dynamic = 'force-dynamic'

// The documents a document links to in its related field, each at its path in the locale asked for.
function RelatedLinks({ locale, related }: { locale?: string; related: Page['related'] }) {
  const links = (related ?? []).flatMap(({ relationTo, value }) =>
    typeof value === 'object' && value.path ? [{ key: `${relationTo}-${value.id}`, path: value.path, title: value.title }] : []
  )
  if (links.length === 0) return null
  return (
    <nav aria-label="Related">
      <ul>
        {links.map(({ key, path, title }) => (
          <li key={key}>
            <a href={locale ? `${path}?locale=${locale}` : path}>{title}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

type Props = {
  params: Promise<{ segments?: string[] }>
  searchParams: Promise<{ draft?: string; locale?: string }>
}

export default async function SitePage({ params, searchParams }: Props) {
  const { segments = [] } = await params
  const { draft, locale } = await searchParams
  const payload = await getPayload({ config })
  const path = `/${segments.join('/')}`
  // Only a logged-in user of the admin sees a draft, for a preview.
  const { user } = await payload.auth({ headers: await headers() })

  // Without `collections`, `found.collection` is one of the plugin's collections, in pathPlugin() or
  // with withPath: pages, posts or topics. Pass `collections: ['pages', 'posts']` to narrow it further.
  const found = await findByPath({
    depth: 1,
    draft: draft === 'true' && user !== null,
    locale,
    path,
    paths: true,
    payload,
    populate: { pages: { path: true, title: true }, posts: { path: true, title: true }, topics: { path: true, title: true } }
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
          <RelatedLinks locale={locale} related={found.document.related} />
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
          <RelatedLinks locale={locale} related={found.document.related} />
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
          <RelatedLinks locale={locale} related={found.document.related} />
          <pre>{JSON.stringify({ path: found.document.path, paths: found.paths }, null, 2)}</pre>
        </main>
      )
    }
  }
}
