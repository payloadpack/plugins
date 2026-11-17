import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'

import type { Id } from '../../src/paths/place.js'
import type { Setup } from './setups.js'

type Document = { [key: string]: unknown; id: Id }

// A collection without drafts has no status to send.
const hasDrafts = (payload: Payload, collection: CollectionSlug) =>
  Boolean(payload.collections[collection].config.versions?.drafts)

// Creates a document as the server, published unless draft is set, and in the transaction of a
// request that has one, which stays open.
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

// Saves a document as the server, published unless draft is set.
export function update(
  payload: Payload,
  collection: CollectionSlug,
  id: Id,
  data: Record<string, unknown>,
  { autosave = false, draft = false, locale }: { autosave?: boolean; draft?: boolean; locale?: string } = {}
) {
  return payload.update({
    autosave,
    collection,
    data: draft || !hasDrafts(payload, collection) ? data : { _status: 'published', ...data },
    draft,
    id,
    locale,
    overrideAccess: true
  }) as Promise<Document>
}

// What a stored document holds beside its slug and title, such as its parent in the collection's parent field.
type Seed = { [field: string]: unknown; slug?: string; title: string }

/**
 * Stores a document as a site held it before it added the plugin: through the database adapter, so
 * no hook ran, and it has a slug and a parent and neither a path nor ancestors. Published, with a
 * latest version that says the same unless a draft says otherwise.
 */
export async function store(
  { payload }: { payload: Payload },
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
  const { id } = await payload.db.create({ collection, data: row(seed, 'published') })
  if (drafts) {
    await payload.db.createVersion({
      autosave: false,
      collectionSlug: collection,
      createdAt: now,
      parent: id,
      updatedAt: now,
      versionData: draft ? row(draft, 'draft') : row(seed, 'published')
    })
  }
  return id as Id
}

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

// Restores a version of a document, the first one unless another is counted out from it, as an
// editor does from its version history.
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

// A document's latest version as the database holds it, with every locale's values.
export async function readLatestVersion(payload: Payload, collection: CollectionSlug, id: Id) {
  const { docs } = await payload.db.findVersions<Document>({
    collection,
    limit: 1,
    pagination: false,
    where: { and: [{ parent: { equals: id } }, { latest: { equals: true } }] }
  })
  return docs[0]!.version
}

// The paths of a document's versions, latest first.
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

// A ValidationError's field errors, as REST would show them.
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
