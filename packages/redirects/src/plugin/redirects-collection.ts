import type { Access, CollectionConfig } from 'payload'

import { buildFromField, FROM_FIELD_NAME } from '../fields/from.js'
import { buildMatchField, MATCH_FIELD_NAME } from '../fields/match.js'
import { buildRegexPathField } from '../fields/regex-path.js'
import { buildStatusField, STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { buildToField } from '../fields/to.js'
import { buildTypeField, TYPE_FIELD_NAME } from '../fields/type.js'
import { buildWinsOverDocumentField } from '../fields/wins-over-document.js'
import type { RedirectsConfig } from './options.js'
import { suggestionsEndpoint } from './suggestions-endpoint.js'

export const REDIRECTS_SLUG = 'redirects'

// The field Payload's orderable keeps a redirect's place in the editors' order in.
export const ORDER_FIELD_NAME = '_order'

// A redirect that is off or suggested answers like none, so visitors read only the ones on, and so does
// a user of any collection but the admin's, as in Payload's own default access.
const readOnOrAdminUser: Access = ({ req: { payload, user } }) =>
  user?.collection === payload.config.admin.user || { [STATUS_FIELD_NAME]: { equals: 'on' satisfies Status } }

export function buildRedirectsCollection({
  collections,
  trackingParameters,
  winOverDocuments
}: Pick<RedirectsConfig, 'collections' | 'trackingParameters' | 'winOverDocuments'>): CollectionConfig {
  return {
    slug: REDIRECTS_SLUG,
    access: { read: readOnOrAdminUser },
    admin: {
      defaultColumns: [FROM_FIELD_NAME, MATCH_FIELD_NAME, TYPE_FIELD_NAME, STATUS_FIELD_NAME],
      useAsTitle: FROM_FIELD_NAME
    },
    endpoints: [suggestionsEndpoint],
    fields: [
      buildFromField(trackingParameters),
      buildMatchField(),
      buildRegexPathField(),
      buildToField(collections),
      buildStatusField(),
      buildTypeField(),
      ...(winOverDocuments === 'perRedirect' ? [buildWinsOverDocumentField()] : [])
    ],
    // Editors drag the regexes into the order they are tried in, the first match winning.
    orderable: true,
    // A redirect is a line in a list, which no editor goes back to an earlier version of, and versions
    // would double every write a move makes.
    versions: false
  }
}
