// The proxy the installation docs give for redirects that win over pages, but for its page lookup, as
// in src/proxy.ts. Next takes it as the proxy only in the build whose page extensions next.config.mjs
// sets to find it.
import payloadConfig from '@payload-config'
import { findRedirect } from '@payloadpack/redirects'
import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'

import { findPage } from './find-page.ts'

// Answers every redirect, since one can win over the page at its path. findRedirect decides by
// winOverDocuments whether a page wins, and asks hasDocument only when it needs to.
export async function proxy(request: NextRequest) {
  let path: string
  try {
    path = decodeURIComponent(request.nextUrl.pathname)
  } catch {
    return NextResponse.next()
  }
  const payload = await getPayload({ config: payloadConfig })
  const hasDocument = async (pathAsked: string) => (await findPage({ path: pathAsked, payload })) !== null

  const { foundRedirect } = await findRedirect({ hasDocument, path, payload, searchParams: request.nextUrl.searchParams })
  if (!foundRedirect) return NextResponse.next()
  // A path on this site goes below its basePath, which Next adds to a page route's redirect() itself.
  const { destination, permanent } = foundRedirect
  const url = destination.startsWith('/') ? `${request.nextUrl.basePath}${destination}` : destination
  return NextResponse.redirect(new URL(url, request.url), permanent ? 308 : 307)
}

// Skips the admin, the API and Next's own files, whole segments only, so a path such as /apiary passes.
export const config = { matcher: ['/((?!(?:admin|api|_next)(?:/|$)).*)'] }
