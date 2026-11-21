import payloadConfig from '@payload-config'
import { findByPath } from '@payloadpack/path'
import { findRedirect } from '@payloadpack/redirects'
import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'

// Answers the redirects that match a query string, which the page route never sees when its page is
// cached per path. A URL without one goes on to the page route, which checks for a redirect itself.
export async function proxy(request: NextRequest) {
  if (request.nextUrl.search === '') return NextResponse.next()

  let path: string
  try {
    path = decodeURIComponent(request.nextUrl.pathname)
  } catch {
    return NextResponse.next()
  }
  const payload = await getPayload({ config: payloadConfig })
  const hasDocument = async (pathAsked: string) => (await findByPath({ path: pathAsked, payload })) !== null

  const { foundRedirect } = await findRedirect({ hasDocument, path, payload, searchParams: request.nextUrl.searchParams })
  if (!foundRedirect) return NextResponse.next()
  // A page always wins over a redirect from its path, but not over one that matched the query string.
  if (!foundRedirect.matchedQueryString && (await hasDocument(path))) return NextResponse.next()
  return NextResponse.redirect(new URL(foundRedirect.destination, request.url), foundRedirect.permanent ? 308 : 307)
}

// Skips the admin, the API and Next's own files, whole segments only, so a path such as /apiary passes.
export const config = { matcher: ['/((?!(?:admin|api|_next)(?:/|$)).*)'] }
