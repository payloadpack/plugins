import type { CollectionSlug, Endpoint, PayloadRequest } from 'payload'

import { FROM_FIELD_NAME } from '../fields/from.js'
import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { TO_FIELD_NAME, type TargetType } from '../fields/to.js'
import { suggestionNotice } from './messages.js'
import { findTargetDocument, getRedirectsConfig } from './options.js'

/** The id of a suggestion, and the text its notice shows. */
export type SuggestionNotice = { id: number | string; text: string }

/**
 * The notices for the suggestions to one document, read as the signed-in user: the redirects visitors
 * read are only the ones on, so a visitor gets none, before any query, whatever id the URL holds. Every
 * edit view asks, and most documents have none, so the document is read only when it has one: as the
 * user reads it, drafts included, with its path built by the plugin's buildDocumentPath.
 */
async function findSuggestionNotices(req: PayloadRequest): Promise<SuggestionNotice[]> {
  const { payload, user } = req
  const config = getRedirectsConfig(payload)
  const collection = req.routeParams?.documentCollection as CollectionSlug
  const id = req.routeParams?.documentId
  if (!user || !config.collections.includes(collection) || (typeof id !== 'string' && typeof id !== 'number')) return []
  const { docs } = await payload.find({
    collection: config.slug,
    depth: 0,
    overrideAccess: false,
    pagination: false,
    req,
    select: { [FROM_FIELD_NAME]: true },
    sort: FROM_FIELD_NAME,
    where: {
      and: [
        { [STATUS_FIELD_NAME]: { equals: 'suggested' satisfies Status } },
        // A target an editor changed to a URL keeps the document it had, which Yes would not send to.
        { [`${TO_FIELD_NAME}.type`]: { equals: 'document' satisfies TargetType } },
        { [`${TO_FIELD_NAME}.document.relationTo`]: { equals: collection } },
        { [`${TO_FIELD_NAME}.document.value`]: { equals: id } }
      ]
    }
  })
  if (docs.length === 0) return []
  const locale = req.locale ?? undefined
  const document = await findTargetDocument({ collection, draft: true, id, locale, payload, req }, config)
  if (!document) return []
  const to = await config.buildDocumentPath({ collection, document, locale, payload, req })
  const { singular } = payload.collections[collection].config.labels
  const label = typeof singular === 'string' ? singular.toLowerCase() : undefined
  return docs.map(({ from, id: redirectId }) => ({ id: redirectId, text: suggestionNotice(label, String(from), to) }))
}

export const SUGGESTIONS_ENDPOINT_PATH = '/suggestions'

export const suggestionsEndpoint: Endpoint = {
  handler: async (req) => Response.json({ notices: await findSuggestionNotices(req) }),
  method: 'get',
  // Payload sets routeParams.collection to the Redirects collection's own slug.
  path: `${SUGGESTIONS_ENDPOINT_PATH}/:documentCollection/:documentId`
}
