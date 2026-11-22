import type { Match, RedirectType, Status } from '@payloadpack/redirects'
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'

export const AUTH_FILE = 'tests/.auth/demo.json'

/**
 * Each test edits as the demo user through its own request, and asks for paths as a visitor, with a
 * request of no session: a signed-in user may read what visitors can't.
 */
export const test = base.extend<{ visitor: APIRequestContext }>({
  visitor: async ({ baseURL, playwright }, use) => {
    const visitor = await playwright.request.newContext({ baseURL })
    await use(visitor)
    await visitor.dispose()
  }
})

type SavedDocument = { _order: string; id: string; path: string }

type Collection = 'news' | 'pages'

type RedirectTarget = { document: { relationTo: Collection; value: string }; type: 'document' } | { type: 'url'; url: string }

type RedirectData = { from: string; match?: Match; status?: Status; to: RedirectTarget; type?: RedirectType }

export const toUrl = (url: string): RedirectTarget => ({ type: 'url', url })

// Publishes a document through the REST API, so each test moves documents of its own.
export async function publish(request: APIRequestContext, collection: Collection, data: Record<string, unknown>) {
  const response = await request.post(`/api/${collection}`, { data: { _status: 'published', ...data } })
  await expect(response).toBeOK()
  return ((await response.json()) as { doc: SavedDocument }).doc
}

async function patch(request: APIRequestContext, path: string, data: object) {
  await expect(await request.patch(path, { data })).toBeOK()
}

// Saves a change to a document and publishes it, as an editor's Publish does, which moves its path.
export const publishChange = (request: APIRequestContext, collection: Collection, id: string, data: object) =>
  patch(request, `/api/${collection}/${id}`, { ...data, _status: 'published' })

export async function createRedirect(request: APIRequestContext, data: RedirectData) {
  const response = await request.post('/api/redirects', { data })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { doc: SavedDocument }).doc
}

export async function visit(visitor: APIRequestContext, path: string) {
  const response = await visitor.get(path, { maxRedirects: 0 })
  const { location } = response.headers()
  return location ? { location, status: response.status() } : { status: response.status() }
}

// The redirects from the paths given, whatever their status, read as the demo user, who reads every one.
export async function findRedirects(request: APIRequestContext, froms: string[]) {
  const params = Object.fromEntries(froms.map((from, index) => [`where[from][in][${index}]`, from]))
  const response = await request.get('/api/redirects', { params: { depth: 0, ...params } })
  await expect(response).toBeOK()
  return ((await response.json()) as { docs: (RedirectData & { id: string })[] }).docs
}

export async function acceptSuggestions(request: APIRequestContext, froms: string[]) {
  for (const { id, status } of await findRedirects(request, froms)) {
    if (status === 'suggested') await patch(request, `/api/redirects/${id}`, { status: 'on' })
  }
}

export async function openDocument(page: Page, collection: Collection, id: string) {
  await page.goto(`/admin/collections/${collection}/${id}`)
  await expect(page.locator('#field-title')).toBeEditable()
}

// The notice a moved page shows for the redirect its move suggests from one path, by its whole text.
export const suggestionNotice = (page: Page, from: string, to: string) =>
  page.getByRole('group', {
    exact: true,
    name: `This page moved from ${from} to ${to}. Should visitors who ask for ${from} be sent here?`
  })
