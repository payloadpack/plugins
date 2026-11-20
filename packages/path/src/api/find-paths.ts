import { createPayloadRequest, type Payload, type PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { findDocumentById } from '../database/documents.js'
import { findDocumentAndLatestVersion, type DocumentAndLatestVersion } from '../database/versions.js'
import { getStoredPathAndAncestors, type Id } from '../path/build-path-and-ancestors.js'
import { getPathConfig, pickCollections, type PathCollectionSlug } from '../plugin/options.js'
import { getLocales, inLocale } from '../utils/locales.js'
import { getShownLocales, isInTrash } from '../utils/published-locales.js'

/** A path a document is at, in the locale it is the document's path in. Without localization there is no locale. */
export type FoundPath = { locale?: string; path: string }

/**
 * The paths of one document in each locale, in the order of the site's locales, so a site links to
 * it in the other locales. It reads as the server, so it gives the paths of the locales the document
 * is published in, and with draft the ones its latest draft would give it in every locale. A locale
 * without a path, a document in the trash and a document that doesn't exist give none.
 */
export async function findPaths({
  collection,
  draft = false,
  id,
  payload,
  req: transactionRequest
}: {
  /** The collection the document is in, among the plugin's. */
  collection: PathCollectionSlug
  /** true gives the paths of the latest draft, for a preview. Defaults to false. */
  draft?: boolean
  /** The document's id. */
  id: Id
  payload: Payload
  /** A request whose transaction the read joins, if any. */
  req?: Partial<PayloadRequest>
}): Promise<FoundPath[]> {
  pickCollections([collection], getPathConfig(payload))
  const config = payload.collections[collection].config
  const req = await createPayloadRequest({ locale: 'all', payload })
  if (transactionRequest?.transactionID) req.transactionID = transactionRequest.transactionID
  const readsDraft = draft && hasDraftsEnabled(config)
  const stored: Partial<DocumentAndLatestVersion> | undefined = readsDraft
    ? await findDocumentAndLatestVersion(config, id, req)
    : { document: await findDocumentById(collection, id, req) }
  const document = stored?.document
  if (!document || isInTrash(document)) return []
  const { paths } = getStoredPathAndAncestors(stored?.version?.version ?? document, collection, payload)
  const locales = readsDraft ? getLocales(payload) : getShownLocales(document, config, payload)
  return locales.flatMap((locale) => {
    const path = paths[locale]
    return path ? [{ ...inLocale(locale), path }] : []
  })
}
