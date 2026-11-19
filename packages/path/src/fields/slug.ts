import type { FieldHook, TextField } from 'payload'
import type { Slugify } from 'payload/shared'

import type { SlugFieldOwnProps } from '../components/slug-field.js'
import { findDocuments } from '../database/documents.js'
import { idOf, isSlug } from '../path/build-path-and-ancestors.js'
import { getParentFieldName, type SlugFieldOptions } from '../plugin/options.js'
import { valueInLocale } from '../utils/locales.js'

// A slug is cleaned on every save, and kept when a save clears it. A save in every locale at once
// that sends a localized slug holds a value per locale. The save's own hook gives a document without
// a slug one from its title. Payload keeps a sent value when a hook returns nothing, so a slug with
// nothing left is null.
const cleanSlug =
  (slugify: Slugify, localized: boolean): FieldHook =>
  async ({ data, originalDoc, req, value }) => {
    const stored: unknown = originalDoc?.slug
    const clean = async (slug: unknown, storedSlug: unknown) =>
      (await slugify({ data: data ?? {}, req, valueToSlugify: slug })) || storedSlug || null
    if (!localized || req.locale !== 'all' || !value) return clean(value, stored)
    const slugs: Record<string, unknown> = {}
    for (const [locale, localeValue] of Object.entries(value)) {
      slugs[locale] = await clean(localeValue, valueInLocale(stored, locale, localized))
    }
    return slugs
  }

// A duplicate keeps its source's parent, so it takes the source's slug with -copy, or -copy-2 and
// up when another document below that parent has that slug in any locale, instead of landing on the
// source's path. In a collection without parents that is any other document. Payload runs it once
// per locale of a localized slug.
const copySlug =
  (localized: boolean): FieldHook =>
  async ({ collection, data, req, value }) => {
    if (!isSlug(value) || !collection) return value
    const parentField = getParentFieldName(collection.slug, req.payload)
    const parentId = parentField === undefined ? null : idOf(data?.[parentField])
    const beside = await findDocuments(
      collection.slug,
      parentField === undefined ? {} : { [parentField]: parentId === null ? { exists: false } : { equals: parentId } },
      req
    )
    const takenSlugs = new Set(beside.flatMap(({ slug }) => (localized ? Object.values(slug ?? {}) : [slug])))
    const copy = `${value}-copy`
    let slug = copy
    for (let number = 2; takenSlugs.has(slug); number++) slug = `${copy}-${number}`
    return slug
  }

// What the plugin builds its slug field from.
type SlugFieldParts = {
  // Whether the collection's documents have a slug per locale.
  localized: boolean
  // What makes a slug from a title or from what an editor typed: the site's own function, or the default.
  slugify: Slugify
  // The collection's title field, which the refresh button makes the slug from.
  useAsTitle: string | undefined
}

/**
 * A text field with the plugin's own hooks, shown as Payload's slug field: locked until the editor
 * unlocks it, with a refresh button that makes the slug from the title. What the site sets on it
 * goes over the plugin's own admin, and the site's hooks run after the plugin's, so they see the
 * cleaned slug.
 */
export function slugField(
  { localized, slugify, useAsTitle }: SlugFieldParts,
  { admin, hooks, ...asGiven }: SlugFieldOptions = {}
): TextField {
  return {
    ...asGiven,
    name: 'slug',
    type: 'text',
    admin: {
      position: 'sidebar',
      ...admin,
      components: {
        Field: {
          clientProps: { useAsSlug: useAsTitle } satisfies SlugFieldOwnProps,
          path: '@payloadpack/path/client#SlugField'
        },
        ...admin?.components
      }
    },
    // The refresh button calls Payload's slugify server function, which runs the function it finds
    // here: what Payload's own slug field relies on, and its docs don't name.
    custom: { slugify },
    hooks: {
      ...hooks,
      beforeDuplicate: [copySlug(localized), ...(hooks?.beforeDuplicate ?? [])],
      beforeValidate: [cleanSlug(slugify, localized), ...(hooks?.beforeValidate ?? [])]
    },
    localized
  }
}
