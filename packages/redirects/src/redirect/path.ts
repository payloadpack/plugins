import { buildQueryString, encodeReadAsOther } from './query-string.js'

// Stands for the site's own origin, so a path parses as a URL on it and a target on another site has
// another origin.
export const SITE_ORIGIN = 'http://site.invalid'

/** The path and each path above it, deepest first: /a/b/c, /a/b and /a for /a/b/c. */
export function buildPathAndPathsAbove(path: string) {
  const paths = [path]
  for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
    paths.push(path.slice(0, end))
  }
  return paths
}

// A run of escapes, such as %C3%A9, decoded where it decodes, so a % that starts no escape stays.
const ESCAPE_RUN = /(?:%[0-9a-f]{2})+/gi

const decodeEscapes = (segment: string) =>
  segment.replace(ESCAPE_RUN, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run
    }
  })

// What a URL reads as something other than a character of a path: % starts an escape, ? a query
// string and # a fragment, a backslash reads as a slash, and a control character is dropped.
const READ_AS_OTHER = /[%?#\\\u0000-\u001f\u007f]/g

/**
 * A path as a redirect from a path compares it: lowercased, as a page's path is, with what a URL
 * reads as something else or drops encoded, such as /q%3Fa for /q?a and /a%20 for a space at the end.
 * So a From that a save sends back cleans to itself, and a visitor's path compares the same way.
 */
export const buildComparedPath = (path: string) => encodeReadAsOther(path.toLowerCase(), READ_AS_OTHER)

/**
 * A From of Exact path or Path and subpaths as the site looks it up, from what an editor typed: a
 * pasted URL becomes its path and query string, a missing first slash is added and a doubled one
 * dropped, a last slash goes, and every segment is decoded and compared as buildComparedPath says. A
 * backslash reads as a slash, as a URL reads it, and so does an encoded slash. The query string is
 * kept as a redirect compares it, after a ?, and none is left when it holds only tracking parameters.
 * Null when the value holds no path on this site, such as // alone, https:// alone or a mailto: link.
 */
export function cleanFromPath(value: string, trackingParameters: readonly string[]) {
  // The site decodes the path a visitor asks for, so an encoded slash is a slash by the time it looks.
  const trimmedValue = value.trim().replace(/%2f/gi, '/')
  if (/^[/\\]{2,}$/.test(trimmedValue)) return null
  const url = URL.parse(trimmedValue.replace(/^[/\\]{2,}/, '/'), SITE_ORIGIN)
  // A scheme of its own, such as mailto: or the old: a URL reads in old:page, leaves no path here.
  if (!url?.pathname.startsWith('/')) return null
  // A pasted URL keeps a doubled first slash in its path, and so does one a dot segment leaves.
  const pathname = url.pathname.replace(/^\/{2,}/, '/').replace(/\/+$/, '')
  const path = pathname.split('/').map(decodeEscapes).join('/') || '/'
  const queryString = buildQueryString(url.searchParams, trackingParameters)
  return `${buildComparedPath(path)}${queryString ? `?${queryString}` : ''}`
}

/**
 * The rest of a path below the path a redirect is from, such as /team/anna for /about-us/team/anna
 * below /about-us, or empty at the path itself. Cut by segments, so a path whose lowercase is longer
 * or shorter than it is cuts at the same place.
 */
export function buildPathBelow(path: string, from: string) {
  const segmentsBelow = path.split('/').slice(from.split('/').length)
  return segmentsBelow.length === 0 ? '' : `/${segmentsBelow.join('/')}`
}

/**
 * A path written as a Location header carries it, segment by segment, so a ? or # in a segment stays
 * in the path, a letter such as ö is encoded and no line break reaches the header.
 */
export function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * The path a visitor's request for a destination on this site is looked up at: its path, decoded
 * segment by segment. Null for another site, and for a path that doesn't decode or holds a slash
 * inside a segment, which the site doesn't look up.
 */
export function buildSitePath(destination: string) {
  if (!destination.startsWith('/')) return null
  const { pathname } = new URL(destination, SITE_ORIGIN)
  try {
    const segments = pathname.split('/').map(decodeURIComponent)
    return segments.some((segment) => segment.includes('/')) ? null : segments.join('/')
  } catch {
    return null
  }
}
