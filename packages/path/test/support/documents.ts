import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'

import type { Id } from '../../src/path/build-path-and-ancestors.js'
import { LOCALES, type Setup } from './setups.js'

type Document = { [key: string]: unknown; id: Id }

const hasDrafts = (payload: Payload, collection: CollectionSlug) =>
  Boolean(payload.collections[collection].config.versions?.drafts)

// Runs in the transaction of a request that has one, and leaves it open.
export function create(
  payload: Payload,
  collection: CollectionSlug,
  data: Record<string, unknown>,
  { draft = false, req }: { draft?: boolean; req?: PayloadRequest } = {}
) {
  return payload.create({
    collection,
    data: hasDrafts(payload, collection) ? { _status: draft ? 'draft' : 'published', ...data } : data,
    draft,
    overrideAccess: true,
    req
  }) as Promise<Document>
}

// Runs in the transaction of a request that has one, and leaves it open.
export function update(
  payload: Payload,
  collection: CollectionSlug,
  id: Id,
  data: Record<string, unknown>,
  {
    autosave = false,
    draft = false,
    locale,
    req
  }: { autosave?: boolean; draft?: boolean; locale?: string; req?: PayloadRequest } = {}
) {
  return payload.update({
    autosave,
    collection,
    data: draft || !hasDrafts(payload, collection) ? data : { _status: 'published', ...data },
    draft,
    id,
    locale,
    overrideAccess: true,
    req
  }) as Promise<Document>
}

type Seed = { [field: string]: unknown; slug?: string; title: string }

// A document as a site held it before it added the plugin: through the database adapter, so no hook
// gives it a path or ancestors.
export async function store(
  { payload, req }: { payload: Payload; req?: PayloadRequest },
  { localized }: Setup,
  collection: CollectionSlug,
  seed: Seed,
  draft?: Seed
) {
  const now = new Date().toISOString()
  const inLocales = (value: unknown) => (localized ? { en: value } : value)
  const drafts = hasDrafts(payload, collection)
  const row = ({ slug, title, ...fields }: Seed, status: string) => ({
    ...fields,
    createdAt: now,
    slug: inLocales(slug),
    title: inLocales(title),
    updatedAt: now,
    ...(drafts ? { _status: inLocales(status) } : {})
  })
  const { id } = await payload.db.create({ collection, data: row(seed, 'published'), req })
  if (drafts) {
    await payload.db.createVersion({
      autosave: false,
      collectionSlug: collection,
      createdAt: now,
      parent: id,
      req,
      updatedAt: now,
      versionData: draft ? row(draft, 'draft') : row(seed, 'published')
    })
  }
  return id as Id
}

// Through the database adapter, so no hook runs, and with the whole row, so it keeps every other value.
async function storeInRow(payload: Payload, collection: CollectionSlug, id: Id, values: Record<string, unknown>) {
  const row = await payload.db.findOne({ collection, where: { id: { equals: id } } })
  await payload.db.updateOne({ collection, data: { ...row, ...values }, id })
}

export function storePathInRow(payload: Payload, { localized }: Setup, collection: CollectionSlug, id: Id, path: string) {
  const paths = localized ? Object.fromEntries(LOCALES.map((locale) => [locale, path])) : path
  return storeInRow(payload, collection, id, { path: paths })
}

export function storeParentInRow(payload: Payload, collection: CollectionSlug, id: Id, parent: Id) {
  return storeInRow(payload, collection, id, { parent })
}

// Through the database adapter, so no hook runs, and with the whole version, so it keeps every other
// value.
export async function storeDraftAncestorsInRow(payload: Payload, collection: CollectionSlug, id: Id, ancestors: Id[]) {
  const latestVersion = await findLatestVersionRow(payload, collection, id)
  await payload.db.updateVersion({
    collection,
    id: latestVersion.id,
    versionData: { ...latestVersion, version: { ...latestVersion.version, ancestors } }
  })
}

// A document made by create is published in English only, so with localization onPathsChanged names
// it in that locale only, also where its Swedish path moved along.
export const changed = (
  { localized }: Setup,
  collection: CollectionSlug,
  { id }: Document,
  from: null | string,
  to: null | string
) => ({ collection, id, ...(localized ? { locale: 'en' } : {}), from, to })

export function remove(payload: Payload, collection: CollectionSlug, id: Id) {
  return payload.delete({ collection, id, overrideAccess: true })
}

export async function readDocument(
  payload: Payload,
  collection: CollectionSlug,
  id: Id,
  { draft = false, locale }: { draft?: boolean; locale?: string } = {}
) {
  return (await payload.findByID({
    collection,
    depth: 0,
    draft,
    id,
    locale,
    overrideAccess: true
  })) as Document
}

export async function readPath(
  payload: Payload,
  collection: CollectionSlug,
  id: Id,
  options: { draft?: boolean; locale?: string } = {}
) {
  return (await readDocument(payload, collection, id, options)).path
}

// version counts from the oldest version, which it restores by default.
export async function restoreVersion(
  payload: Payload,
  collection: CollectionSlug,
  id: Id,
  { draft = false, locale, version = 0 }: { draft?: boolean; locale?: string; version?: number } = {}
) {
  const { docs } = await payload.findVersions({
    collection,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    sort: 'createdAt',
    where: { parent: { equals: id } }
  })
  return payload.restoreVersion({ collection, draft, id: docs[version]!.id, locale, overrideAccess: true })
}

const whereLatestVersion = (id: Id): Where => ({ and: [{ parent: { equals: id } }, { latest: { equals: true } }] })

async function findLatestVersionRow(payload: Payload, collection: CollectionSlug, id: Id) {
  const { docs } = await payload.db.findVersions<Document>({
    collection,
    limit: 1,
    pagination: false,
    where: whereLatestVersion(id)
  })
  return docs[0]!
}

// As the database holds it, with every locale's values.
export async function readLatestVersion(payload: Payload, collection: CollectionSlug, id: Id) {
  return (await findLatestVersionRow(payload, collection, id)).version
}

export async function countLatestVersions(payload: Payload, collection: CollectionSlug, id: Id) {
  const { docs } = await payload.db.findVersions({ collection, pagination: false, where: whereLatestVersion(id) })
  return docs.length
}

export async function readVersionPaths(payload: Payload, collection: CollectionSlug, id: Id, where: Where = {}) {
  const { docs } = await payload.findVersions({
    collection,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    sort: '-updatedAt',
    where: { and: [{ parent: { equals: id } }, where] }
  })
  return docs.map(({ version }) => (version as Record<string, unknown>).path)
}

export async function readRows(payload: Payload, collection: CollectionSlug, ids: Id[]) {
  const { docs: documents } = await payload.db.find({
    collection,
    pagination: false,
    sort: 'id',
    where: { id: { in: ids } }
  })
  const versions = hasDrafts(payload, collection)
    ? (await payload.db.findVersions({ collection, pagination: false, sort: 'id', where: { parent: { in: ids } } })).docs
    : []
  return { documents, versions }
}

export async function catchFieldErrors(work: Promise<unknown>) {
  try {
    await work
  } catch (error) {
    const { data } = error as { data?: { errors?: { locale?: string; message: string; path: string }[] } }
    if (data?.errors) return data.errors
    throw error
  }
  throw new Error('Expected the operation to be refused')
}
