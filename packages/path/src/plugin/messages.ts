import { ValidationError, type CollectionSlug, type PayloadRequest } from 'payload'

import type { StoredDocument } from '../database/documents.js'
import { getFallbackLocales, NO_LOCALE, valueInLocale } from '../utils/locales.js'
import type { TakenPath } from '../validation/find-taken-path.js'

// The docs pages copy these messages word for word.

// The slug a refusal is shown on, whatever caused it, because the slug is what an editor changes.
export const REFUSAL_FIELD = 'slug'

export function buildFieldError(collection: string, fieldName: string, message: string, req: PayloadRequest, locale?: string) {
  return new ValidationError({
    collection,
    errors: [{ message, path: fieldName, ...(locale && locale !== NO_LOCALE ? { locale } : {}) }],
    req
  })
}

const getLabel = (label: unknown, req: PayloadRequest): string => {
  if (typeof label === 'function') return String(label({ i18n: req.i18n, t: req.t }))
  if (label && typeof label === 'object') {
    const labels = label as Record<string, string>
    return labels[req.i18n.language] ?? Object.values(labels)[0] ?? ''
  }
  return String(label ?? '')
}

function getCollectionLabel(collectionSlug: string, number: 'plural' | 'singular', req: PayloadRequest) {
  return getLabel(req.payload.collections[collectionSlug as CollectionSlug].config.labels[number], req)
}

const getLowercaseLabels = (collectionSlug: string, req: PayloadRequest) => ({
  plural: getCollectionLabel(collectionSlug, 'plural', req).toLowerCase(),
  singular: getCollectionLabel(collectionSlug, 'singular', req).toLowerCase()
})

function getTitleFieldName(collectionSlug: string, req: PayloadRequest) {
  return req.payload.collections[collectionSlug as CollectionSlug].config.admin.useAsTitle ?? 'id'
}

function describeDocument(collectionSlug: string, stored: StoredDocument, locale: string, req: PayloadRequest) {
  // A document read through Payload holds the title of one locale, one read from the database every
  // locale, where a locale without its own title takes the one it falls back to.
  const title = stored[getTitleFieldName(collectionSlug, req)]
  const text =
    typeof title === 'string' || !req.payload.config.localization
      ? title
      : getFallbackLocales(req.payload, locale)
          .map((titleLocale) => valueInLocale(title, titleLocale, true))
          .find((value) => typeof value === 'string' && value !== '')
  return `${getCollectionLabel(collectionSlug, 'singular', req)} "${String(text ?? stored.id)}"`
}

export const MISSING_SLUG_REFUSAL = 'Give this document a slug, or a title to make one from.'

export const MISSING_PARENT_REFUSAL = "The parent doesn't exist, so pick another one."

export const PARENT_WITHOUT_PATH_REFUSAL = 'The parent has no path yet, so save the parent first.'

export const BELOW_ITSELF_REFUSAL = "A document can't sit below itself, so pick another parent."

export function homePageParentRefusal(collectionSlug: string, req: PayloadRequest) {
  const { plural } = getLowercaseLabels(collectionSlug, req)
  return `The home page can't hold ${plural}, so pick another parent.`
}

export function homePageBranchRefusal(collectionSlug: string, req: PayloadRequest) {
  const { plural, singular } = getLowercaseLabels(collectionSlug, req)
  return `The home page can't hold ${plural}, so move the ones under this ${singular} first.`
}

export const becomesHomePageRefusal = (collectionSlug: string, lifted: StoredDocument, locale: string, req: PayloadRequest) =>
  `${describeDocument(collectionSlug, lifted, locale, req)} would become the home page at /, so change its slug first.`

// A reserved segment given in a list has no reason to show.
export const reservedAnyDepthRefusal = (segment: string, reason?: string) =>
  `A path can't hold ${segment}${reason === undefined ? '' : `, which ${reason}`}, so pick another slug.`

export const reservedRootRefusal = (segment: string, reason = 'something else') =>
  `The site serves ${reason} at /${segment}, so pick another slug or a parent.`

export const ADMIN_ROUTE_REASON = 'the admin panel'

export const API_ROUTE_REASON = 'the API'

// Where describeTakenPath says the document is when it is at the path of the document being saved.
export const THIS_PATH = 'this path'

function describeTakenPath({ collection, document, locale, path }: TakenPath, req: PayloadRequest, here = path) {
  // In another locale than the editor's, the refusal names that locale, since the editor doesn't see it.
  const where = locale === NO_LOCALE || locale === req.locale ? here : `${path} in ${locale}`
  return `${describeDocument(collection, document, locale, req)} is already at ${where}, so change the slug or the parent.`
}

export const buildTakenPathError = (collection: string, taken: TakenPath, req: PayloadRequest, here?: string) =>
  buildFieldError(collection, REFUSAL_FIELD, describeTakenPath(taken, req, here), req, taken.locale)

export const BASE_PATH_IS_ROOT = 'is the root already, so leave basePath out'

export const BASE_PATH_WITHOUT_FIRST_SLASH = "doesn't start with a slash, so start it with one"

export const BASE_PATH_WITH_LAST_SLASH = 'ends with a slash, so remove that slash'

export const BASE_PATH_WITH_EMPTY_SEGMENT = 'has an empty segment, so remove the extra slash'

export const basePathError = (basePath: string, collectionSlug: string, fault: string) =>
  `@payloadpack/path was given the base path ${basePath} for ${collectionSlug}, which ${fault}.`

export const missingCollectionsError = (collectionSlugs: string[]) =>
  `@payloadpack/path was given collections the config doesn't have: ${collectionSlugs.join(', ')}.`

export const repeatedCollectionsError = (collectionSlugs: string[]) =>
  `@payloadpack/path was given ${collectionSlugs.join(', ')} more than once, so list each collection once.`

export const takenFieldNamesError = (fieldNames: string[], collectionSlug: string) =>
  `@payloadpack/path adds ${fieldNames.join(' and ')} to ${collectionSlug}, so remove its own.`

export const parentFieldWithoutParentError = (collectionSlug: string) =>
  `@payloadpack/path adds no parent field to ${collectionSlug}, so leave out its parentField.`

export const notGivenCollectionsError = (collectionSlugs: string[]) =>
  `@payloadpack/path was asked for collections that pathPlugin() wasn't given: ${collectionSlugs.join(', ')}.`

export const PLUGIN_MISSING_ERROR =
  '@payloadpack/path: add pathPlugin() to the Payload config before calling findByPath, findPaths or backfillPaths'
