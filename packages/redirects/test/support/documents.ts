import { createPayloadRequest, type CollectionSlug, type Payload, type PayloadRequest } from 'payload'

import {
  findRedirect,
  type FindRedirectArgs,
  type Match,
  type RedirectType,
  type Status,
  type TargetType
} from '../../src/index.js'

type Document = { [field: string]: unknown; id: number | string }

type RedirectData = {
  from: string
  match?: Match
  status?: Status
  to: { document?: { relationTo: string; value: number | string }; type: TargetType; url?: string }
  type?: RedirectType
  // Only with winOverDocuments 'perRedirect'.
  winsOverDocument?: boolean
}

type StoredRedirect = Document & RedirectData & { _order: string; lookupPath?: null | string }

export const toDocument = (collection: string, { id }: Document): RedirectData['to'] => ({
  document: { relationTo: collection, value: id },
  type: 'document'
})

export const toUrl = (url: string): RedirectData['to'] => ({ type: 'url', url })

export function createRedirect(payload: Payload, data: RedirectData) {
  return payload.create({
    collection: 'redirects',
    data: data as never,
    depth: 0,
    overrideAccess: true
  }) as Promise<StoredRedirect>
}

export function updateRedirect(payload: Payload, id: number | string, data: Partial<RedirectData> & Record<string, unknown>) {
  return payload.update({
    collection: 'redirects',
    data: data as never,
    depth: 0,
    id,
    overrideAccess: true
  }) as Promise<StoredRedirect>
}

export async function findRedirectByID(payload: Payload, id: number | string) {
  return (await payload.findByID({ collection: 'redirects', depth: 0, id, overrideAccess: true })) as unknown as StoredRedirect
}

export async function findRedirects(payload: Payload) {
  const { docs } = await payload.find({
    collection: 'redirects',
    depth: 0,
    overrideAccess: true,
    pagination: false,
    sort: 'from'
  })
  return docs as unknown as StoredRedirect[]
}

export async function acceptSuggestions(payload: Payload, froms: string[], collection = 'redirects') {
  await payload.update({
    collection: collection as CollectionSlug,
    data: { status: 'on' } as never,
    depth: 0,
    overrideAccess: true,
    where: { and: [{ from: { in: froms } }, { status: { equals: 'suggested' } }] }
  })
}

export function publish(
  payload: Payload,
  collection: CollectionSlug,
  data: Record<string, unknown>,
  { locale }: { locale?: string } = {}
) {
  return payload.create({
    collection,
    data: { _status: 'published', ...data },
    depth: 0,
    locale,
    overrideAccess: true
  }) as Promise<Document & { path?: string }>
}

// A draft that was never published, which visitors can't read.
export function createDraft(payload: Payload, collection: CollectionSlug, data: Record<string, unknown>) {
  return payload.create({
    collection,
    data: { _status: 'draft', ...data },
    depth: 0,
    draft: true,
    overrideAccess: true
  }) as Promise<Document>
}

// Publishes the change, so a new slug or parent moves the document.
export function publishChange(
  payload: Payload,
  collection: CollectionSlug,
  { id }: Document,
  data: Record<string, unknown>,
  { locale, req }: { locale?: string; req?: PayloadRequest } = {}
) {
  return payload.update({
    collection,
    data: { _status: 'published', ...data },
    depth: 0,
    id,
    locale,
    overrideAccess: true,
    req
  }) as Promise<Document & { path?: string }>
}

export function remove(payload: Payload, collection: CollectionSlug, { id }: Document) {
  return payload.delete({ collection, id, overrideAccess: true })
}

// One editor per site: each user's password hash costs about 60 ms.
const editors = new WeakMap<Payload, ReturnType<typeof createEditor>>()

async function createEditor(payload: Payload) {
  const editor = await payload.create({
    collection: 'users',
    data: { email: 'editor@example.com', password: 'editor' },
    overrideAccess: true
  })
  return { ...editor, collection: 'users' as const }
}

// The request of a signed-in editor, who reads drafts and every redirect.
export async function createEditorRequest(payload: Payload, req: Partial<PayloadRequest> = {}) {
  if (!editors.has(payload)) editors.set(payload, createEditor(payload))
  return createPayloadRequest({ payload, req, user: await editors.get(payload)! })
}

// The request of a user of another auth collection than the admin's, such as a shop's customer, who
// reads what a visitor reads. One per site, as the editor is.
const members = new WeakMap<Payload, ReturnType<typeof createMember>>()

async function createMember(payload: Payload) {
  const member = await payload.create({
    collection: 'members',
    data: { email: 'member@example.com', password: 'member' },
    overrideAccess: true
  })
  return { ...member, collection: 'members' as const }
}

export async function createMemberRequest(payload: Payload) {
  if (!members.has(payload)) members.set(payload, createMember(payload))
  return createPayloadRequest({ payload, user: await members.get(payload)! })
}

export const buildSuggestionsRequest = (collection: string, { id }: Document, locale?: string): Partial<PayloadRequest> => ({
  locale,
  routeParams: { documentCollection: collection, documentId: String(id) }
})

export async function findFoundRedirect(args: FindRedirectArgs) {
  return (await findRedirect(args)).foundRedirect
}

export function recordHasDocument() {
  const askedPaths: string[] = []
  const heldPaths = new Set<string>()
  const hasDocument = (path: string) => {
    askedPaths.push(path)
    return heldPaths.has(path)
  }
  return { askedPaths, hasDocument, heldPaths }
}

export async function catchFieldErrors(work: Promise<unknown>) {
  try {
    await work
  } catch (error) {
    const { data } = error as { data?: { errors?: { message: string; path: string }[] } }
    if (data?.errors) return data.errors
    throw error
  }
  throw new Error('Expected the save to be refused')
}

type FoundOptions = { matchedQueryString?: boolean; permanent?: boolean }

const buildFoundRedirect = (
  type: TargetType,
  destination: string,
  { matchedQueryString = false, permanent = true }: FoundOptions = {}
) => ({ destination, matchedQueryString, permanent, to: { type } })

export const foundDocument = (destination: string, options?: FoundOptions) => buildFoundRedirect('document', destination, options)

export const foundUrl = (destination: string, options?: FoundOptions) => buildFoundRedirect('url', destination, options)
