/**
 * A visitor's query string as a site has it: a URLSearchParams, such as request.nextUrl.searchParams
 * in a Next proxy, or a page's searchParams, awaited.
 */
export type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams

/** The parameters that say where a visitor came from, which no redirect compares. */
const DEFAULT_TRACKING_PARAMETERS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']

/** The tracking parameters, the defaults and a site's own, lowercased as they are compared. */
export const buildTrackingParameters = (siteParameters: string[] = []) => [
  ...new Set([...DEFAULT_TRACKING_PARAMETERS, ...siteParameters].map((name) => name.toLowerCase()))
]

export function buildSearchParams(searchParams: SearchParams | undefined) {
  if (searchParams instanceof URLSearchParams) return searchParams
  const urlSearchParams = new URLSearchParams()
  for (const [name, value] of Object.entries(searchParams ?? {})) {
    for (const singleValue of typeof value === 'string' ? [value] : (value ?? [])) urlSearchParams.append(name, singleValue)
  }
  return urlSearchParams
}

// The characters a parameter can't hold decoded and still read back the same: % starts an escape, &
// ends a parameter, = ends its name, + reads as a space and # starts a fragment.
const KEPT_ENCODED = /[%&=+#]/g

/**
 * Text with what a URL reads as something else encoded, the characters readAsOther finds, and with
 * the whitespace at its end encoded, which trim() and a URL drop. So cleaning what it gives again gives
 * the same. Sliced off rather than matched, so a run of spaces costs what any other character does.
 */
export function encodeReadAsOther(text: string, readAsOther: RegExp) {
  const trimmedText = text.trimEnd()
  return `${trimmedText.replace(readAsOther, encodeURIComponent)}${encodeURIComponent(text.slice(trimmedText.length))}`
}

const encodeKept = (part: string) => encodeReadAsOther(part, KEPT_ENCODED)

// By code unit, so a save and a lookup sort alike on any machine.
const compare = (first: string, second: string) => (first < second ? -1 : first > second ? 1 : 0)

/**
 * A query string as a redirect compares it: lowercased and decoded, its tracking parameters left
 * out and the rest sorted by name and then value, such as id=123 for ?ID=123&utm_source=mail. Empty
 * when nothing is left. Cleaning what it gives again gives the same.
 */
export function buildQueryString(searchParams: URLSearchParams, trackingParameters: readonly string[]) {
  return [...searchParams]
    .map(([name, value]) => [name.toLowerCase(), value.toLowerCase()] as const)
    .filter(([name]) => !trackingParameters.includes(name))
    .sort(
      ([firstName, firstValue], [secondName, secondValue]) => compare(firstName, secondName) || compare(firstValue, secondValue)
    )
    .map(([name, value]) => `${encodeKept(name)}=${encodeKept(value)}`)
    .join('&')
}

/** The tracking parameters of a visitor's query string, as the visitor sent them. */
export const buildTrackingSearchParams = (searchParams: URLSearchParams, trackingParameters: readonly string[]) =>
  new URLSearchParams([...searchParams].filter(([name]) => trackingParameters.includes(name.toLowerCase())))

// A regex that matches a literal ?, written \?, or a ? followed by a name and =, such as
// /news.aspx?id=(\d+). A path the site looks up holds no query string, so either is meant for one.
// (?i), (?:…), a? and (?=…) are none of these.
const REGEX_QUERY_STRING = /\\\?|\?[\w.-]+=/

/** Whether a regex is written to match a query string, which only Exact path can. */
export const hasRegexQueryString = (regex: string) => REGEX_QUERY_STRING.test(regex)
