import type { FieldHook, TextField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

import { BELOW_ROOT_REFUSAL, FROM_TOO_LONG_REFUSAL, FROM_WITHOUT_PATH_REFUSAL, QUERY_STRING_REFUSAL } from '../plugin/messages.js'
import { cleanFromPath, LONGEST_REDIRECTED_PATH } from '../redirect/path.js'
import { getRegexRefusal } from '../redirect/regex.js'
import { hasRegexQueryString } from '../redirect/query-string.js'
import { MATCH_FIELD_NAME, type Match } from './match.js'

export const FROM_FIELD_NAME = 'from'

/**
 * The most bytes a stored From holds in UTF-8. Postgres's unique index on from holds at most 2,704
 * bytes a row, and a From of this many bytes has at most as many characters, so it stays within the
 * longest path a lookup answers too.
 */
const MOST_FROM_BYTES = LONGEST_REDIRECTED_PATH

/** Whether a From, as it is stored, holds more bytes than a From may. */
export const isFromTooLong = (from: string) => new TextEncoder().encode(from).length > MOST_FROM_BYTES

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

  // Validation gets the stored fields with the sent ones over them, and on a save the from cleanFrom
  // gave, whose query string, cleaned, is still after a ?. The admin's form validates what the editor
  // typed instead, so the length is measured on the from as it will be stored.
  const validateFrom: TextFieldSingleValidation = (value, options) => {
    const textRefusal = text(value, options)
    if (textRefusal !== true || !value) return textRefusal
    const { match } = options.siblingData as FromSiblings
    if (match === 'regex') {
      const regex = value.trim()
      if (isFromTooLong(regex)) return FROM_TOO_LONG_REFUSAL
      return hasRegexQueryString(regex) ? QUERY_STRING_REFUSAL : (getRegexRefusal(regex) ?? true)
    }
    const from = cleanFromPath(value, trackingParameters)
    if (from === null) return FROM_WITHOUT_PATH_REFUSAL
    if (isFromTooLong(from)) return FROM_TOO_LONG_REFUSAL
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
