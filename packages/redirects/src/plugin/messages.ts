// The docs pages copy these messages word for word.

export const FROM_WITHOUT_PATH_REFUSAL = 'Give the path visitors ask for, such as /old-page, or paste the whole old URL.'

export const FROM_TOO_LONG_REFUSAL =
  'This is far longer than any path visitors ask for. Give only the path, such as /old-page: a From holds at most 2,048 characters, and a letter outside a to z, such as é or 中, counts as two or more.'

export const BELOW_ROOT_REFUSAL = 'Every path is a subpath of /, so pick Exact path for the home page, or write a regex.'

export const unreadableRegexRefusal = (reason: string) =>
  `This isn't a regex the site can read (${reason}). A regex can't look ahead or behind or refer back to a group, and a backslash before a character such as ( or . matches it as it is.`

export const REGEX_TOO_LARGE_REFUSAL =
  'This regex is too large to try on every unknown path, usually because of a repeat such as {1000}. Split it into simpler regexes, or repeat a part fewer times.'

export const QUERY_STRING_REFUSAL =
  'Only Exact path matches a query string, such as ?id=123, so pick Exact path or leave the query string out.'

export const URL_REFUSAL = 'Start with / for a path on this site, or with https:// for another site.'

// Page stands in for a label that isn't a plain string, and the path now is left out when none can
// be built.
export const suggestionNotice = (label: string | undefined, from: string, to: null | string) =>
  `This ${label ?? 'page'} moved from ${from}${to === null ? '' : ` to ${to}`}. Should visitors who ask for ${from} be sent here?`

export const SUGGESTION_YES_BUTTON = 'Yes, redirect them'

export const SUGGESTION_NO_BUTTON = 'No'

export const SUGGESTION_EDIT_BUTTON = 'Edit'

export const PLUGIN_MISSING_ERROR =
  '@payloadpack/redirects: add redirectsPlugin() to the Payload config before calling findRedirect or suggestRedirects'

export const EMPTY_COLLECTIONS_ERROR =
  '@payloadpack/redirects: collections is empty, so name at least one collection a redirect can send visitors to'

export const WIN_OVER_DOCUMENTS_ERROR =
  "@payloadpack/redirects: winOverDocuments is 'perRedirect', so an editor picks the redirects that win over a document, or 'always', so every redirect does, or left out, so a document wins over every redirect but one that matched the query string"

export const HAS_DOCUMENT_MISSING_ERROR =
  "@payloadpack/redirects: give findRedirect hasDocument, which says whether a document holds a path, because with winOverDocuments 'perRedirect' a document at the path wins over every redirect but the ones an editor picked and one that matched the query string"
