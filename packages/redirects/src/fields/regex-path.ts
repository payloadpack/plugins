import type { FieldHook, TextField } from 'payload'

import { buildRegexPath } from '../redirect/regex.js'
import { FROM_FIELD_NAME } from './from.js'
import { MATCH_FIELD_NAME, type Match } from './match.js'

export const REGEX_PATH_FIELD_NAME = 'regexPath'

type RegexSiblings = { [FROM_FIELD_NAME]?: string; [MATCH_FIELD_NAME]?: Match }

// Set on every save, from the stored fields with the sent ones over them, which Payload has merged
// before any change hook runs, so a save that sends only some fields keeps it.
const setRegexPath: FieldHook = ({ siblingData }) => {
  const { from, match } = siblingData as RegexSiblings
  return match === 'regex' && from ? buildRegexPath(from) : null
}

/**
 * The fixed start of a regex, indexed, by which a lookup finds the regexes that could match a path.
 * Null for a redirect from a path.
 */
export const buildRegexPathField = (): TextField => ({
  name: REGEX_PATH_FIELD_NAME,
  type: 'text',
  admin: { hidden: true },
  hooks: { beforeChange: [setRegexPath] },
  index: true
})
