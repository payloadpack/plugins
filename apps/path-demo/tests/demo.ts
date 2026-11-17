import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// What playwright.config.ts gives each project, so one run tests the demo without and with localization.
export type DemoMetadata = { authFile: string; localized: boolean }

export const demo = () => test.info().project.metadata as DemoMetadata

type Saved = { id: string; path: string }

// The demo's collections with paths: pages, posts without a parent, and topics with Payload's hierarchy.
type Collection = 'pages' | 'posts' | 'topics'

async function createDocument(request: APIRequestContext, collection: Collection, data: Record<string, unknown>, draft: boolean) {
  const response = await request.post(`/api/${collection}`, {
    data: { _status: draft ? 'draft' : 'published', ...data },
    params: { draft }
  })
  await expect(response).toBeOK()
  return ((await response.json()) as { doc: Saved }).doc
}

// Creates a published document through the REST API, so each test edits documents of its own.
export const createPublished = (request: APIRequestContext, collection: Collection, data: Record<string, unknown>) =>
  createDocument(request, collection, data, false)

// Publishes a document in Swedish through the REST API, with the values it has in that locale.
export async function publishInSwedish(
  request: APIRequestContext,
  collection: Collection,
  id: string,
  data: Record<string, unknown>
) {
  const response = await request.patch(`/api/${collection}/${id}`, {
    data: { _status: 'published', ...data },
    params: { locale: 'sv' }
  })
  await expect(response).toBeOK()
}

// Creates a draft through the REST API, which Payload stores without checking that it is complete.
export const createDraft = (request: APIRequestContext, collection: Collection, data: Record<string, unknown>) =>
  createDocument(request, collection, data, true)

// A seeded page, by its slug in English.
export async function findSeededPage(request: APIRequestContext, slug: string) {
  const response = await request.get(`/api/pages?where[slug][equals]=${slug}&locale=en&depth=0`)
  await expect(response).toBeOK()
  return ((await response.json()) as { docs: Saved[] }).docs[0]!
}

// With localization the admin opens the locale the user picked last, so a test names its own.
export async function openDocument(page: Page, collection: Collection, id: string, locale = demo().localized ? 'en' : undefined) {
  await page.goto(`/admin/collections/${collection}/${id}${locale ? `?locale=${locale}` : ''}`)
  await expect(page.locator('#field-title')).toBeEditable()
}

// Opens "Create new" for a collection, where the admin stores an empty draft at once and shows it.
export async function openNewDocument(page: Page, collection: Collection) {
  await page.goto(`/admin/collections/${collection}/create`)
  await page.waitForURL(new RegExp(`/admin/collections/${collection}/(?!create)[^/?]+`))
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  await openDocument(page, collection, id)
  return id
}

/**
 * The published document at a path, asked for through the REST API: each collection for the
 * published document whose stored path it is. The demo has no page of a site yet, so nothing in it
 * calls findByPath itself.
 */
export async function findPublishedAt(request: APIRequestContext, path: string) {
  for (const collection of ['pages', 'posts'] as const) {
    const response = await request.get(`/api/${collection}`, {
      params: {
        depth: 0,
        limit: 1,
        ...(demo().localized ? { locale: 'en' } : {}),
        'where[_status][equals]': 'published',
        'where[path][equals]': path
      }
    })
    await expect(response).toBeOK()
    const [document] = ((await response.json()) as { docs: (Saved & { title: string })[] }).docs
    if (document) return { collection, document }
  }
  return null
}

export async function publish(page: Page) {
  await page.locator('#action-save').click()
}

export const pathField = (page: Page) => page.locator('#field-path')

export const slugField = (page: Page) => page.locator('#field-slug')

// The slug is locked until an editor unlocks it, and only then shows its refresh button.
export async function unlockSlug(page: Page) {
  await page.getByRole('button', { exact: true, name: 'Unlock' }).click()
  await expect(slugField(page)).toBeEditable()
}

export const refreshSlug = (page: Page) => page.getByRole('button', { exact: true, name: 'Generate' })

/**
 * Picks a topic's parent as an editor does in a collection with Payload's hierarchy: with the
 * button in the header, which shows the parent the topic has, in the dialog it opens. The form has
 * no field for the parent, and the move is saved with the topic.
 */
export async function pickParentTopic(page: Page, title: string) {
  await page.getByRole('button', { name: /^Folder location:/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { exact: true, name: title }).check()
  await dialog.getByRole('button', { exact: true, name: 'Confirm' }).click()
  await expect(page.getByRole('button', { exact: true, name: `Folder location: ${title}` })).toBeVisible()
}
