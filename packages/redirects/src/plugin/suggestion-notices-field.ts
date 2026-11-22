import type { UIField } from 'payload'

import type { SuggestionNoticesProps } from '../admin/suggestion-notices.js'
import { SUGGESTIONS_ENDPOINT_PATH } from './suggestions-endpoint.js'

const SUGGESTION_NOTICES_FIELD_NAME = 'redirectSuggestions'

/**
 * Stores nothing: the first field of a collection a redirect can send visitors to, so its notices
 * show above the title. Payload's edit view has no place above the fields but a field.
 */
export const buildSuggestionNoticesField = (redirectsSlug: string): UIField => ({
  name: SUGGESTION_NOTICES_FIELD_NAME,
  type: 'ui',
  admin: {
    components: {
      Field: {
        clientProps: {
          redirectsSlug,
          suggestionsPath: `/${redirectsSlug}${SUGGESTIONS_ENDPOINT_PATH}`
        } satisfies SuggestionNoticesProps,
        path: '@payloadpack/redirects/client#SuggestionNotices'
      }
    },
    disabled: { bulkEdit: true, column: true }
  }
})
