'use client'

import { SlugField as PayloadSlugField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'

// What the plugin's slug field hands its component, beside what Payload gives every field.
export type SlugFieldOwnProps = {
  // The name of the field the refresh button makes the slug from. Without one, it makes nothing.
  useAsSlug: string | undefined
}

/**
 * The plugin's slug field as Payload's own slug field shows one: locked until the editor unlocks
 * it, with a refresh button. The field itself is a text field, so it is handed over as the slug
 * field Payload's component takes, with the field to make a slug from.
 */
export function SlugField({ field, path, useAsSlug }: TextFieldClientProps & SlugFieldOwnProps) {
  return <PayloadSlugField field={{ ...field, type: 'slug', useAsSlug }} path={path} />
}
