import type { RadioField } from 'payload'

export const TYPE_FIELD_NAME = 'type'

/** Permanent answers 308 and temporary 307. */
export type RedirectType = 'permanent' | 'temporary'

export const buildTypeField = (): RadioField => ({
  name: TYPE_FIELD_NAME,
  type: 'radio',
  admin: { position: 'sidebar' },
  defaultValue: 'permanent' satisfies RedirectType,
  options: [
    { label: 'Permanent (308)', value: 'permanent' satisfies RedirectType },
    { label: 'Temporary (307)', value: 'temporary' satisfies RedirectType }
  ],
  required: true
})
