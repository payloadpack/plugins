import type {
  CollectionConfig,
  CollectionSlug,
  JsonObject,
  Payload,
  PayloadRequest,
  RequestContext,
  SelectType,
  TypeWithID
} from 'payload'

import { mergeTrackingParameters } from '../redirect/query-string.js'
import { EMPTY_COLLECTIONS_ERROR, PLUGIN_MISSING_ERROR, WIN_OVER_DOCUMENTS_ERROR } from './messages.js'

/** What buildDocumentPath gets: a document a redirect sends visitors to, which the plugin has read. */
export type BuildDocumentPathArgs = {
  /** The collection the document is in, one of collections. */
  collection: CollectionSlug
  /**
   * The document at depth 0, with the fields documentSelect names, as the request's user reads it:
   * the visitor for a lookup, or the editor, drafts included, for a notice.
   */
  document: JsonObject & TypeWithID
  /**
   * The locale the document was read in: the one findRedirect was given, or the editor's for a
   * notice.
   */
  locale?: string
  /** For a site that reads more to build a path, which costs every redirect to a document a query. */
  payload: Payload
  /** The request findRedirect was given, or the editor's for a notice, for such a read. */
  req?: PayloadRequest
}

/**
 * Builds the path of a document a redirect sends visitors to from the document, the way the site
 * builds its URLs: decoded, such as /blog/café, and without a query string. None, or anything but a
 * path on this site, sends nobody, so the next redirect that covers the path answers.
 */
export type BuildDocumentPath = (args: BuildDocumentPathArgs) => null | Promise<null | string | undefined> | string | undefined

/**
 * Which redirects win over a document at a path they cover: the ones an editor picks with each
 * redirect's winsOverDocument, or every redirect that is on. A redirect that matched the visitor's
 * query string always does.
 */
export type WinOverDocuments = 'always' | 'perRedirect'

const WIN_OVER_DOCUMENTS: readonly WinOverDocuments[] = ['always', 'perRedirect']

export type RedirectsPluginOptions = {
  /**
   * Builds the path of a document a redirect sends visitors to, from the document, such as
   * ({ document }) => document.path for the path @payloadpack/path keeps.
   */
  buildDocumentPath: BuildDocumentPath
  /** The collections a redirect can send visitors to a document of. */
  collections: CollectionSlug[]
  /**
   * The fields buildDocumentPath reads, such as { path: true }, so a lookup reads only those of the
   * document a redirect sends visitors to. Without it, the whole document.
   */
  documentSelect?: SelectType
  /** Changes the redirects collection the plugin builds, such as to add hooks of the site's own. */
  overrides?: (collection: CollectionConfig) => CollectionConfig
  /**
   * Query string parameters no redirect compares, beside utm_source, utm_medium, utm_campaign,
   * utm_term, utm_content, gclid and fbclid, such as a newsletter's own. A destination keeps them.
   */
  trackingParameters?: string[]
  /**
   * Lets redirects win over a document at a path they cover: 'perRedirect' for the ones an editor
   * picks, with a box on each redirect, and 'always' for every redirect that is on. Without it, a
   * document wins over every redirect but one that matched the visitor's query string, so a site asks
   * for a redirect only where no document holds the path.
   */
  winOverDocuments?: WinOverDocuments
}

export type RedirectsConfig = Pick<RedirectsPluginOptions, 'collections' | 'documentSelect' | 'winOverDocuments'> & {
  /** The site's buildDocumentPath, giving null for anything that doesn't start with a slash. */
  buildDocumentPath: (args: BuildDocumentPathArgs) => Promise<null | string>
  /** The redirects collection's slug, which overrides may change. */
  slug: CollectionSlug
  /** The defaults and the site's own, lowercased. */
  trackingParameters: string[]
}

const REDIRECTS_PLUGIN_KEY = 'redirectsPlugin'

// So a whole URL it gives never sends visitors to another site. buildDestination refuses a path a
// browser reads as another site, such as //other.example.
const keepPathOnSite =
  (buildDocumentPath: BuildDocumentPath) =>
  async (args: BuildDocumentPathArgs): Promise<null | string> => {
    const documentPath = await buildDocumentPath(args)
    return typeof documentPath === 'string' && documentPath.startsWith('/') ? documentPath : null
  }

export function buildRedirectsConfig({
  buildDocumentPath,
  collections,
  documentSelect,
  trackingParameters,
  winOverDocuments
}: RedirectsPluginOptions): Omit<RedirectsConfig, 'slug'> {
  if (collections.length === 0) throw new Error(EMPTY_COLLECTIONS_ERROR)
  if (winOverDocuments !== undefined && !WIN_OVER_DOCUMENTS.includes(winOverDocuments)) {
    throw new Error(WIN_OVER_DOCUMENTS_ERROR)
  }
  return {
    buildDocumentPath: keepPathOnSite(buildDocumentPath),
    collections,
    documentSelect,
    trackingParameters: mergeTrackingParameters(trackingParameters),
    winOverDocuments
  }
}

type TargetDocumentRead = Pick<BuildDocumentPathArgs, 'collection' | 'locale' | 'payload' | 'req'> & {
  context?: RequestContext
  // Drafts included, as an editor reads a document.
  draft?: boolean
  id: number | string
}

/** Null when the request's user can't read the document. */
export const findTargetDocument = (
  { collection, context, draft, id, locale, payload, req }: TargetDocumentRead,
  { documentSelect }: RedirectsConfig
) =>
  payload.findByID({
    collection,
    context,
    depth: 0,
    disableErrors: true,
    draft,
    id,
    locale,
    overrideAccess: false,
    req,
    select: documentSelect
  })

export const withRedirectsConfig = (custom: Record<string, unknown> | undefined, redirectsConfig: RedirectsConfig) => ({
  ...custom,
  [REDIRECTS_PLUGIN_KEY]: redirectsConfig
})

export function getRedirectsConfig({ config }: Payload): RedirectsConfig {
  const redirectsConfig = config.custom?.[REDIRECTS_PLUGIN_KEY] as RedirectsConfig | undefined
  if (!redirectsConfig) throw new Error(PLUGIN_MISSING_ERROR)
  return redirectsConfig
}
