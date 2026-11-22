import config from '@payload-config'
import { findRedirect } from '@payloadpack/redirects'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { findPage } from '../../../find-page'

type Props = { params: Promise<{ segments?: string[] }> }

export default async function SitePage({ params }: Props) {
  const { segments = [] } = await params
  const payload = await getPayload({ config })
  // Next gives each segment encoded, so /öppettider comes as %C3%B6ppettider.
  const path = `/${segments.map(decodeURIComponent).join('/')}`

  const page = await findPage({ path, payload })
  if (page) return <h1>{page.title}</h1>

  // With hasDocument, a redirect that lands on a path no document holds is looked up again, so a
  // visitor takes one hop through a chain.
  const { foundRedirect } = await findRedirect({
    hasDocument: async (nextPath) => (await findPage({ path: nextPath, payload })) !== null,
    path,
    payload
  })
  if (!foundRedirect) notFound()
  if (foundRedirect.permanent) permanentRedirect(foundRedirect.destination)
  redirect(foundRedirect.destination)
}
