'use client'

import { SlugField as PayloadSlugField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'

export type SlugFieldOwnProps = {
  // The name of the field the refresh button makes the slug from. Without one, it makes nothing.
  useAsSlug: string | undefined
}

/**
 * The plugin's slug field as Payload's own slug field shows one: locked until the editor unlocks
 * it, with a refresh button. The field itself is a text field, so it is handed over as the slug
 * field Payload's component takes, with the field to make a slug from. Payload's component reads
 * read-only off the field alone, so an editor the field's access keeps from changing the slug gets
 * it there, and sees neither the lock nor the refresh button.
 */
export function SlugField({ field, path, readOnly, useAsSlug }: TextFieldClientProps & SlugFieldOwnProps) {
  const admin = { ...field.admin, readOnly: readOnly || field.admin?.readOnly }
  return <PayloadSlugField field={{ ...field, admin, type: 'slug', useAsSlug }} path={path} />
}
