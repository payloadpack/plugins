import type { FieldHook, TextField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

import { BELOW_ROOT_REFUSAL, FROM_WITHOUT_PATH_REFUSAL, QUERY_STRING_REFUSAL } from '../plugin/messages.js'
import { cleanFromPath } from '../redirect/path.js'
import { getRegexRefusal } from '../redirect/regex.js'
import { hasRegexQueryString } from '../redirect/query-string.js'
import { MATCH_FIELD_NAME, type Match } from './match.js'

export const FROM_FIELD_NAME = 'from'

type FromSiblings = { [MATCH_FIELD_NAME]?: Match }

/** Only Exact path keeps a query string, compared without the tracking parameters given. */
export function buildFromField(trackingParameters: readonly string[]): TextField {
  // A save may send only some fields, such as a reorder or a status changed, so the stored document
  // fills in the match the save leaves out. Without it a stored regex would be cleaned as a path.
  const cleanFrom: FieldHook = ({ previousSiblingDoc, siblingData, value }) => {
    if (typeof value !== 'string') return value
    const { match } = { ...previousSiblingDoc, ...siblingData } as FromSiblings
    return match === 'regex' ? value.trim() : (cleanFromPath(value, trackingParameters) ?? value)
  }

  // Validation gets the stored fields with the sent ones over them, and the from cleanFrom gave, whose
  // query string, cleaned, is still after a ?.
  const validateFrom: TextFieldSingleValidation = (value, options) => {
    const textRefusal = text(value, options)
    if (textRefusal !== true || !value) return textRefusal
    const { match } = options.siblingData as FromSiblings
    if (match === 'regex') return hasRegexQueryString(value) ? QUERY_STRING_REFUSAL : (getRegexRefusal(value) ?? true)
    const from = cleanFromPath(value, trackingParameters)
    if (from === null) return FROM_WITHOUT_PATH_REFUSAL
    if (match !== 'below') return true
    if (from.includes('?')) return QUERY_STRING_REFUSAL
    return from === '/' ? BELOW_ROOT_REFUSAL : true
  }

  return {
    name: FROM_FIELD_NAME,
    type: 'text',
    hooks: { beforeValidate: [cleanFrom] },
    required: true,
    unique: true,
    validate: validateFrom
  }
}
