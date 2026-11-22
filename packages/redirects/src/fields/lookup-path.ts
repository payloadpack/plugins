import type { FieldHook, TextField } from 'payload'

import { getFixedStart } from '../redirect/regex.js'
import { FROM_FIELD_NAME } from './from.js'
import { MATCH_FIELD_NAME, type Match } from './match.js'

export const LOOKUP_PATH_FIELD_NAME = 'lookupPath'

type LookupSiblings = { [FROM_FIELD_NAME]?: string; [MATCH_FIELD_NAME]?: Match }

// Set on every save, from the stored fields with the sent ones over them, which Payload has merged
// before any change hook runs, so a save that sends only some fields keeps it.
const setLookupPath: FieldHook = ({ siblingData }) => {
  const { from, match } = siblingData as LookupSiblings
  if (!from) return null
  return match === 'regex' ? getFixedStart(from) : from
}

/**
 * The path a lookup finds a redirect at, indexed: the From of a redirect from a path, and the fixed
 * start of a regex. Every redirect has one, so no value is shared by most of them, which a database
 * with statistics would rather read every redirect for than search.
 */
export const buildLookupPathField = (): TextField => ({
  name: LOOKUP_PATH_FIELD_NAME,
  type: 'text',
  admin: { hidden: true },
  hooks: { beforeChange: [setLookupPath] },
  index: true
})
