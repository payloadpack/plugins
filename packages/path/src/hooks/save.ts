import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, PayloadRequest, SanitizedCollectionConfig } from 'payload'
import { hasLocalizeStatusEnabled } from 'payload/shared'

import { planBranchMove, writeBranchMove } from '../paths/branch.js'
import { checkNewPaths, checkParent, findNewPaths } from '../paths/checks.js'
import { getFallbackLocales, getLocales, NO_LOCALE, valueInLocale } from '../paths/locales.js'
import {
  getOwnSlugLocales,
  idOf,
  isSamePlace,
  readStoredPlace,
  workOutPlace,
  type Id,
  type Place,
  type Stored
} from '../paths/place.js'
import { getPublishedLocales, getShownLocales, hasDrafts, isInTrash } from '../paths/status.js'
import { findDocuments, readParentPlace, readStored, workOutStoredPlace, writePlace, writePlan } from '../paths/stored.js'
import { buildFieldError, MISSING_SLUG_REFUSAL, THIS_PATH } from '../plugin/messages.js'
import {
  changedPath,
  findBranchChange,
  getParentFieldName,
  getPathConfig,
  isLocalized,
  type ChangedPath
} from '../plugin/options.js'
import { documentKey, getPathContext, type PlaceBefore } from './context.js'

/**
 * What a save holds of a field. Of a localized one it holds the value of the locale it is in, or a
 * value per locale when it is in every locale at once. Of one that isn't localized it holds the one
 * value, which is every locale's.
 */
function readSaved(req: PayloadRequest, localized: boolean) {
  const perLocale = localized && req.locale === 'all'
  const savedLocales = localized && !perLocale ? [req.locale ?? NO_LOCALE] : getLocales(req.payload)
  return {
    // What the data holds of a value per locale.
    inData: <Value>(values: Record<string, Value>) => (perLocale ? values : values[savedLocales[0]!]),
    // A value of the data, in each locale the save holds it in.
    inLocales: (value: unknown): Record<string, unknown> =>
      perLocale ? { ...(value as object) } : Object.fromEntries(savedLocales.map((locale) => [locale, value])),
    savedLocales
  }
}

type SavedData = { collection: SanitizedCollectionConfig; data: Record<string, unknown>; id: Id | undefined; req: PayloadRequest }

/**
 * The slug of each locale the save holds one of. A document without a slug in any locale takes one
 * from its title. A locale without a slug of its own, on a document with one in another locale,
 * falls back to that one, so a translated title never moves a path. In a collection with drafts the
 * rule of a place does that. In one without, a locale has a path only with a slug of its own, so the
 * save keeps the slug it falls back to as the locale's own.
 */
async function readSlugs({ collection, data, id, req }: SavedData): Promise<Record<string, unknown>> {
  const { payload } = req
  const localized = isLocalized(collection.slug, payload)
  const { inLocales, savedLocales } = readSaved(req, localized)
  const slugs = inLocales(data.slug)
  if (savedLocales.some((savedLocale) => slugs[savedLocale])) return slugs
  // Only of a localized slug can a stored document have one in a locale the save holds no value of:
  // in its latest version, or in the document itself in a collection without drafts.
  if (id !== undefined && localized) {
    const stored = await readStored(collection, id, req)
    const latest = stored?.version?.version ?? stored?.document
    const fallbacks = savedLocales.map((savedLocale): [string, unknown] => [
      savedLocale,
      getFallbackLocales(payload, savedLocale)
        .map((slugLocale) => valueInLocale(latest?.slug, slugLocale, localized))
        .find((slug) => typeof slug === 'string' && slug !== '')
    ])
    if (fallbacks.some(([, slug]) => slug)) return hasDrafts(collection) ? slugs : Object.fromEntries(fallbacks)
  }
  // The title is a field of the site's own, localized or not whatever the slug is.
  const titleField = collection.flattenedFields.find(({ name }) => name === collection.admin.useAsTitle)
  const titles = readSaved(req, Boolean(titleField?.localized)).inLocales(titleField && data[titleField.name])
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

/**
 * Before the write: refuses what the data itself shows, and puts the planned path and ancestors in
 * the data, as the save holds a path, so Payload's own write carries them: into the latest version
 * always, and into the document itself when Payload writes that. It predicts nothing of that write.
 * The hook after it looks. Payload's dry-run validate runs this hook too, so it only reads.
 */
export const planPathBeforeSave: CollectionBeforeChangeHook = async ({ collection, data, operation, originalDoc, req }) => {
  const { payload } = req
  const { slug } = collection
  const localized = isLocalized(slug, payload)
  const { inData, savedLocales } = readSaved(req, localized)
  // A duplicate is created with its source as the original.
  const id: Id | undefined = operation === 'create' ? undefined : originalDoc?.id
  const publishes = !hasDrafts(collection) || data._status === 'published'
  const slugs = await readSlugs({ collection, data, id, req })
  // A draft without a slug has no path yet. A stored document may have a localized slug in another
  // locale to fall back to, which only the hook after the write sees.
  const fallsBack = localized && hasDrafts(collection) && id !== undefined
  if (publishes && !fallsBack && savedLocales.every((savedLocale) => !slugs[savedLocale])) {
    throw buildFieldError(slug, 'slug', MISSING_SLUG_REFUSAL, req)
  }
  // Payload fills a field a save leaves out from the latest version, except in a restore. On MongoDB
  // a restored version from before the document had a parent holds none, and Payload's write then
  // leaves the document the parent it has, so the data says that the document keeps it.
  const parentField = getParentFieldName(slug, payload)
  const parentId =
    parentField === undefined ? null : idOf(data[parentField] === undefined ? originalDoc?.[parentField] : data[parentField])
  const parent = await readParentPlace(slug, parentId, req)
  checkParent(slug, { id, parent, parentId }, req)
  const plan = workOutPlace({ parentId, slugs }, parent, collection, payload)
  const [document] = id === undefined ? [] : await findDocuments(slug, { id: { equals: id } }, req)
  const before: PlaceBefore | undefined = document && {
    ...readStoredPlace(document, slug, payload),
    shownLocales: getShownLocales(document, collection, payload)
  }
  // A path the document itself is at already was checked when it got there. A document in the trash
  // takes no path, so one that a save takes out of it takes the paths it stores again.
  const leavesTrash = document !== undefined && isInTrash(document) && data.deletedAt === null
  const savedIn = new Set(savedLocales)
  const newPaths = findNewPaths(plan, before).filter(([pathLocale]) => savedIn.has(pathLocale))
  const takenAgain = leavesTrash && before ? findNewPaths(before) : []
  await checkNewPaths(collection, id, [...takenAgain, ...newPaths], req, leavesTrash ? undefined : THIS_PATH)
  if (id !== undefined && before) {
    // A save moves the document now where it publishes, and where a site doesn't find the document,
    // so that the document's own slug doesn't count there.
    const ownSlugLocales = new Set(getOwnSlugLocales(before.shownLocales, slug, payload))
    const movedPaths = newPaths.filter(([pathLocale]) => publishes || !ownSlugLocales.has(pathLocale))
    if (movedPaths.length > 0) {
      await planBranchMove({
        collection,
        document: { ...data, id },
        parent: { ancestors: plan.ancestors, id, paths: { ...before.paths, ...Object.fromEntries(movedPaths) } },
        req
      })
    }
    getPathContext(req).saved.set(documentKey(slug, id), before)
  }
  return {
    ...data,
    path: inData(plan.paths) ?? null,
    slug: inData(slugs),
    // A collection without parents stores neither ancestors nor a parent.
    ...(parentField === undefined ? {} : { ancestors: plan.ancestors, ...(parentId === null ? {} : { [parentField]: parentId }) })
  }
}

// Which paths show something else after a save, from where a site found the document before the write
// and where it finds it after: each path it finds it at now and didn't before, or that the save
// published it at, and each path it found it at before and doesn't now.
function findChangedPaths(
  { collection, place, req, stored }: Pick<SavedData, 'collection' | 'req'> & { place: Place; stored: Stored },
  before: PlaceBefore | undefined
) {
  const { payload } = req
  // A save publishes in the locales it holds a status of, and in a collection without drafts, which
  // has none, in the ones it holds a slug of.
  const publishesPerLocale = hasDrafts(collection) ? hasLocalizeStatusEnabled(collection) : isLocalized(collection.slug, payload)
  const savedLocales = new Set(readSaved(req, publishesPerLocale).savedLocales)
  const publishedLocales = new Set(getPublishedLocales(stored.version?.version ?? stored.document, collection, payload))
  const shownLocales = new Set(getShownLocales(stored.document, collection, payload))
  const shownLocalesBefore = new Set(before?.shownLocales)
  const shownBefore = (locale: string) => (shownLocalesBefore.has(locale) ? before?.paths[locale] : null) ?? null
  const shownNow = (locale: string) => (shownLocales.has(locale) ? place.paths[locale] : null) ?? null
  const changedPaths: ChangedPath[] = []
  for (const locale of shownLocales) {
    const path = shownNow(locale)
    // The save published the document in a locale it publishes in when it left no draft there.
    const published = savedLocales.has(locale) && publishedLocales.has(locale)
    if (path && (published || shownBefore(locale) !== path)) changedPaths.push(changedPath(locale, path))
  }
  for (const locale of shownLocalesBefore) {
    const path = shownBefore(locale)
    if (path && path !== shownNow(locale)) changedPaths.push(changedPath(locale, path))
  }
  return changedPaths
}

/**
 * After the write, the plugin looks: it reads the document and its latest version, works out the
 * place and the plan by the one rule, and writes each where the row stores another one. That covers
 * what only Payload's write decided, such as the locales a publish in one locale leaves in the
 * document. When the place is another one than before the write, the documents below follow. Every
 * check runs before the first write, and the site hears which paths changed after the last.
 */
export const placeAfterSave: CollectionAfterChangeHook = async ({ collection, doc, operation, req }) => {
  const { payload } = req
  const { slug } = collection
  const { saved } = getPathContext(req)
  const key = documentKey(slug, doc.id)
  const before = operation === 'create' ? undefined : saved.get(key)
  saved.delete(key)
  const stored = await readStored(collection, doc.id, req)
  if (!stored) return doc
  const { document, version } = stored
  const place = await workOutStoredPlace(stored, 'place', collection, req)
  const plan = version ? await workOutStoredPlace(stored, 'plan', collection, req) : place
  const storedPlace = readStoredPlace(document, slug, payload)
  const storedPlan = version && readStoredPlace(version.version, slug, payload)
  // In a collection with drafts every locale falls back to a slug, so a published locale without a
  // path belongs to a document without a slug in any locale.
  const withoutPath = getPublishedLocales(document, collection, payload).find((locale) => place.paths[locale] === null)
  if (hasDrafts(collection) && withoutPath !== undefined) {
    throw buildFieldError(slug, 'slug', MISSING_SLUG_REFUSAL, req, withoutPath)
  }
  // A path is new where the document wasn't at it before the write and Payload's write didn't carry
  // it, which the hook before the write checked. The same for a plan the latest version doesn't store.
  const newPaths = [...findNewPaths(place, before, storedPlace), ...(storedPlan ? findNewPaths(plan, storedPlan) : [])]
  await checkNewPaths(collection, doc.id, newPaths, req, THIS_PATH)
  // The place changed when it is another one than the document was at before the write, whoever wrote it.
  const placeChanged = operation === 'update' && !(before && isSamePlace(before, place))
  const branchMove = placeChanged
    ? await planBranchMove({ collection, document, parent: { ...place, id: doc.id }, req })
    : undefined
  const changedPaths = findChangedPaths({ collection, place, req, stored }, before)
  // The document needs a write when it stores another place than the one worked out, and so does the
  // latest version for the plan.
  const writesPlan = version && storedPlan && !isSamePlace(plan, storedPlan)
  if (!isSamePlace(place, storedPlace)) await writePlace(slug, document, place, req)
  if (writesPlan) await writePlan(slug, version, plan, req)
  if (branchMove) await writeBranchMove(branchMove, req)
  const moved =
    branchMove &&
    before &&
    findBranchChange({ collection: slug, documentsBelow: branchMove.documentsBelow, id: doc.id }, before.paths, place.paths)
  if (changedPaths.length > 0 || moved) {
    await getPathConfig(payload).onPathsChanged?.({ ...(moved ? { moved } : {}), paths: changedPaths }, req)
  }
  // Payload made the saved document before this hook wrote, so it gets the path the hook worked out.
  const { inData } = readSaved(req, isLocalized(slug, payload))
  const written = writesPlan || (!version && !isSamePlace(place, storedPlace))
  return written ? { ...doc, path: inData(plan.paths) ?? null } : doc
}
