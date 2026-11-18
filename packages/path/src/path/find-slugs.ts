import type { PayloadRequest, SanitizedCollectionConfig } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import { findDocumentAndLatestVersion } from '../database/versions.js'
import { getPathConfig, isLocalized } from '../plugin/options.js'
import { getFallbackLocales, getSaved, NO_LOCALE, valueInLocale } from '../utils/locales.js'
import type { Id } from './build-path-and-ancestors.js'

/**
 * The slug of each locale the save holds one of. A document without a slug in any locale takes one
 * from its title. A locale without a slug of its own, on a document with one in another locale,
 * falls back to that one, so a translated title never moves a path. In a collection with drafts the
 * rule of a path does that. In one without, a locale has a path only with a slug of its own, so the
 * save keeps the slug it falls back to as the locale's own.
 */
export async function findSlugs({
  collection,
  data,
  id,
  req
}: {
  collection: SanitizedCollectionConfig
  data: Record<string, unknown>
  id: Id | undefined
  req: PayloadRequest
}): Promise<Record<string, unknown>> {
  const { payload } = req
  const localized = isLocalized(collection.slug, payload)
  const { inLocales, savedLocales } = getSaved(req, localized)
  const slugs = inLocales(data.slug)
  if (savedLocales.some((savedLocale) => slugs[savedLocale])) return slugs
  // Only of a localized slug can a stored document have one in a locale the save holds no value of:
  // in its latest version, or in the document itself in a collection without drafts.
  if (id !== undefined && localized) {
    const stored = await findDocumentAndLatestVersion(collection, id, req)
    const latest = stored?.version?.version ?? stored?.document
    const fallbacks = savedLocales.map((savedLocale): [string, unknown] => [
      savedLocale,
      getFallbackLocales(payload, savedLocale)
        .map((slugLocale) => valueInLocale(latest?.slug, slugLocale, localized))
        .find((slug) => typeof slug === 'string' && slug !== '')
    ])
    if (fallbacks.some(([, slug]) => slug)) return hasDraftsEnabled(collection) ? slugs : Object.fromEntries(fallbacks)
  }
  // The title is a field of the site's own, localized or not whatever the slug is.
  const titleField = collection.flattenedFields.find(({ name }) => name === collection.admin.useAsTitle)
  const titles = getSaved(req, Boolean(titleField?.localized)).inLocales(titleField && data[titleField.name])
  const { slugify } = getPathConfig(payload)
  const makeSlug = async (title: unknown) => (await slugify({ data, req, valueToSlugify: title })) || undefined
  // One slug for every locale is made once: from the title of the locale the save is in, and in a
  // save of every locale at once from the default locale's title, or the first there is.
  if (!localized) {
    const titleLocales = getFallbackLocales(payload, req.locale ?? NO_LOCALE)
    const slug = await makeSlug(titleLocales.map((titleLocale) => titles[titleLocale]).find(Boolean))
    return slug ? inLocales(slug) : slugs
  }
  const fromTitles: Record<string, unknown> = {}
  for (const savedLocale of savedLocales) fromTitles[savedLocale] = await makeSlug(titles[savedLocale])
  return Object.values(fromTitles).some(Boolean) ? fromTitles : slugs
}
