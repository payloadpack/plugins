import config from '@payload-config'
import { findByPath } from '@payloadpack/path'
import { findRedirect } from '@payloadpack/redirects'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { getPayload } from 'payload'

type Props = { params: Promise<{ segments?: string[] }> }

export default async function SitePage({ params }: Props) {
  const { segments = [] } = await params
  const payload = await getPayload({ config })
  // Next gives each segment encoded, so /öppettider comes as %C3%B6ppettider.
  const path = `/${segments.map(decodeURIComponent).join('/')}`

  const found = await findByPath({ path, payload })
  if (found) {
    return (
      <main>
        <p>Collection: {found.collection}</p>
        <h1>{found.document.title}</h1>
      </main>
    )
  }

  // With hasDocument, a redirect that lands on a path no document holds is looked up again, so a
  // visitor takes one hop through a chain.
  const { foundRedirect } = await findRedirect({
    hasDocument: async (nextPath) => (await findByPath({ path: nextPath, payload })) !== null,
    path,
    payload
  })
  if (!foundRedirect) notFound()
  if (foundRedirect.permanent) permanentRedirect(foundRedirect.destination)
  redirect(foundRedirect.destination)
}
