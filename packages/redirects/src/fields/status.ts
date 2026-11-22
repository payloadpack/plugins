import type { SelectField } from 'payload'

export const STATUS_FIELD_NAME = 'status'

/**
 * Whether a redirect answers: on, off, which answers as if it weren't there, or suggested, which a
 * move saved and which answers nobody until someone says yes.
 */
export type Status = 'off' | 'on' | 'suggested'

/** Leaves out the option only a move writes, which an editor never picks, but on a redirect that has it. */
export function buildSuggestedOptionFilter(fieldName: string, suggestedValue: string): NonNullable<SelectField['filterOptions']> {
  return ({ data, options }) => {
    if (data[fieldName] === suggestedValue) return options
    return options.filter((option) => (typeof option === 'string' ? option : option.value) !== suggestedValue)
  }
}

export const buildStatusField = (): SelectField => ({
  name: STATUS_FIELD_NAME,
  type: 'select',
  admin: { isClearable: false, position: 'sidebar' },
  defaultValue: 'on' satisfies Status,
  filterOptions: buildSuggestedOptionFilter(STATUS_FIELD_NAME, 'suggested' satisfies Status),
  options: [
    { label: 'On', value: 'on' satisfies Status },
    { label: 'Off', value: 'off' satisfies Status },
    { label: 'Suggested', value: 'suggested' satisfies Status }
  ],
  required: true
})
