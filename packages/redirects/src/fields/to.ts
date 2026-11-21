import type { CollectionSlug, FieldHook, GroupField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

import { URL_REFUSAL } from '../plugin/messages.js'
import { isUrlTarget } from '../redirect/destination.js'

export const TO_FIELD_NAME = 'to'

/** What a redirect sends visitors to: a document, wherever it is, or a URL. */
export type TargetType = 'document' | 'url'

export type StoredTarget = { document?: { relationTo?: string; value?: unknown } | null; type?: TargetType; url?: null | string }

type TargetSiblings = { type?: TargetType }

const trim: FieldHook = ({ value }) => (typeof value === 'string' ? value.trim() : value)

// The admin validates without running hooks, so a URL is checked as the trim stores it.
const validateUrl: TextFieldSingleValidation = (value, options) => {
  const textRefusal = text(value, options)
  if (textRefusal !== true || !value) return textRefusal
  return isUrlTarget(value.trim()) ? true : URL_REFUSAL
}

export const buildToField = (collections: CollectionSlug[]): GroupField => ({
  name: TO_FIELD_NAME,
  type: 'group',
  fields: [
    {
      name: 'type',
      type: 'radio',
      defaultValue: 'document' satisfies TargetType,
      label: 'Send visitors to',
      options: [
        { label: 'A document on this site', value: 'document' satisfies TargetType },
        { label: 'A URL', value: 'url' satisfies TargetType }
      ],
      required: true
    },
    {
      name: 'document',
      type: 'relationship',
      admin: { condition: (_, target: TargetSiblings) => target.type === 'document' },
      relationTo: collections,
      required: true
    },
    {
      name: 'url',
      type: 'text',
      admin: { condition: (_, target: TargetSiblings) => target.type === 'url' },
      hooks: { beforeValidate: [trim] },
      label: 'URL',
      required: true,
      validate: validateUrl
    }
  ]
})
