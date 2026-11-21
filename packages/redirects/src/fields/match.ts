import type { SelectField } from 'payload'

import { buildSuggestedOptionFilter } from './status.js'

export const MATCH_FIELD_NAME = 'match'

/** Which paths a redirect covers: its own path, its path and every path below it, or a regex's matches. */
export type Match = 'below' | 'exact' | 'regex'

/** The match a move suggests, which editors see only on a redirect that has it. */
export const SUGGESTED_MATCH = 'below' satisfies Match

export const buildMatchField = (): SelectField => ({
  name: MATCH_FIELD_NAME,
  type: 'select',
  admin: { isClearable: false },
  defaultValue: 'exact' satisfies Match,
  filterOptions: buildSuggestedOptionFilter(MATCH_FIELD_NAME, SUGGESTED_MATCH),
  options: [
    { label: 'Exact path', value: 'exact' satisfies Match },
    { label: 'Path and subpaths', value: SUGGESTED_MATCH },
    { label: 'Regex', value: 'regex' satisfies Match }
  ],
  required: true
})
