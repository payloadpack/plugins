import { encodePath, SITE_ORIGIN } from './path.js'

// $1 to $9 in a target, each filled with what a regex's group captured.
const CAPTURE_GROUP = /\$(\d)/g

export type DestinationParts = {
  /** The parts a regex's groups captured, by group number, which go in for $1, $2 and so on. */
  captures?: (string | undefined)[]
  /** The rest of a path below the path a redirect is from, which goes on below the target. */
  pathBelow?: string
  /** The parameters of the visitor's query string the destination keeps, after the target's own. */
  searchParams?: URLSearchParams
}

// Where the target has a parameter of the same name, the target's value wins.
function addSearchParams(destination: URL, searchParams: URLSearchParams | undefined) {
  const visitorParams = [...(searchParams ?? [])].filter(([name]) => !destination.searchParams.has(name))
  if (visitorParams.length === 0) return
  const visitorQueryString = new URLSearchParams(visitorParams).toString()
  destination.search = destination.search ? `${destination.search}&${visitorQueryString}` : visitorQueryString
}

/** Whether a URL target is a path on this site or a whole URL on another one, as its field asks. */
export function isUrlTarget(target: string) {
  const url = URL.parse(target.replace(CAPTURE_GROUP, ''), SITE_ORIGIN)
  if (!url) return false
  return target.startsWith('/') ? url.origin === SITE_ORIGIN : /^https?:\/\//.test(target)
}

// A backslash or a tab, which a browser can read as a slash.
const READ_AS_SLASH = /[\\\t]/

/**
 * Where a target sends a visitor, written as a Location header carries it: an editor's own ? and #
 * kept, the visitor's parameters given after them, and a letter such as ö encoded. What a visitor's
 * path fills in may not change the site the target goes to, as /other.example after the first slash
 * of /$1 or .other.example after https://shop.example would, so such a redirect sends nobody and
 * gives null. So does one where it fills in a backslash or a tab.
 */
export function buildDestination(target: string, { captures, pathBelow, searchParams }: DestinationParts = {}) {
  const filledInParts = [
    ...(captures ? [...target.matchAll(CAPTURE_GROUP)].map(([, groupNumber]) => captures[Number(groupNumber)] ?? '') : []),
    ...(pathBelow ? [pathBelow] : [])
  ]
  if (filledInParts.some((part) => READ_AS_SLASH.test(part))) return null
  const filledTarget = captures
    ? target.replace(CAPTURE_GROUP, (_, groupNumber: string) => encodePath(captures[Number(groupNumber)] ?? ''))
    : target
  const destination = URL.parse(filledTarget, SITE_ORIGIN)
  const intendedUrl = URL.parse(target.replace(CAPTURE_GROUP, ''), SITE_ORIGIN)
  if (!destination || !intendedUrl || destination.origin !== intendedUrl.origin) return null
  if (pathBelow) destination.pathname = `${destination.pathname.replace(/\/$/, '')}${encodePath(pathBelow)}`
  addSearchParams(destination, searchParams)
  // A target that starts with a slash is a path on this site, so it never leaves it.
  if (destination.origin !== SITE_ORIGIN) return target.startsWith('/') ? null : destination.href
  // A captured .. or a path below the home page can make //other.example, which a browser reads as
  // another site, and so does a backslash after the first slash.
  const path = `${destination.pathname}${destination.search}${destination.hash}`
  return /^\/[/\\]/.test(path) ? null : path
}
