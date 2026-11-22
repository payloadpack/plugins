// The proxy the installation docs give for redirects from a query string, but for its page lookup,
// findPage. A page view no redirect covers never asks it.
import payloadConfig from '@payload-config'
import { findRedirect } from '@payloadpack/redirects'
import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'

import { findPage } from './find-page.ts'

// Answers the redirects that match a query string, which the page route never sees when its page is
// cached per path. A URL without one goes on to the page route, which checks for a redirect itself.
export async function proxy(request: NextRequest) {
  if (request.nextUrl.search === '') return NextResponse.next()

  let path: string
  try {
    // A page's path has no slash at its end, which a site with trailingSlash adds.
    path = decodeURIComponent(request.nextUrl.pathname).replace(/\/$/, '') || '/'
  } catch {
    return NextResponse.next()
  }
  const payload = await getPayload({ config: payloadConfig })
  const hasDocument = async (pathAsked: string) => (await findPage({ path: pathAsked, payload })) !== null

  const { foundRedirect } = await findRedirect({ hasDocument, path, payload, searchParams: request.nextUrl.searchParams })
  if (!foundRedirect) return NextResponse.next()
  // A page always wins over a redirect from its path, but not over one that matched the query string.
  if (!foundRedirect.matchedQueryString && (await hasDocument(path))) return NextResponse.next()
  // A path on this site goes below its basePath, which Next adds to a page route's redirect() itself.
  const { destination, permanent } = foundRedirect
  const url = destination.startsWith('/') ? `${request.nextUrl.basePath}${destination}` : destination
  return NextResponse.redirect(new URL(url, request.url), permanent ? 308 : 307)
}

// Skips the admin, the API and Next's own files, whole segments only, so a path such as /apiary passes.
export const config = { matcher: ['/((?!(?:admin|api|_next)(?:/|$)).*)'] }
