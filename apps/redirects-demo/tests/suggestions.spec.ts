import { expect, type Page } from '@playwright/test'

import { acceptSuggestions, findRedirects, openDocument, publish, publishChange, suggestionNotice, test, visit } from './demo'

// A select shows its options, in a menu outside the field, once it is opened.
async function openOptions(page: Page, fieldName: string) {
  await page.locator(`#field-${fieldName} .rs__control`).click()
  return page.locator('.rs__option')
}

async function expectOptions(page: Page, fieldName: string, labels: string[]) {
  await expect(await openOptions(page, fieldName)).toHaveText(labels)
  await page.keyboard.press('Escape')
}

test('suggests a redirect from the old path of the seeded move, which answers nobody yet', async ({ request, visitor }) => {
  expect(await visit(visitor, '/about-us')).toEqual({ status: 404 })
  expect(await visit(visitor, '/about-us/team')).toEqual({ status: 404 })
  expect(await findRedirects(request, ['/about-us'])).toEqual([
    expect.objectContaining({ from: '/about-us', match: 'below', status: 'suggested' })
  ])
})

test('redirects the old path once an editor says yes on the moved page', async ({ page, request, visitor }) => {
  const harbour = await publish(request, 'pages', { slug: 'harbour', title: 'Harbour' })
  await publishChange(request, 'pages', harbour.id, { slug: 'marina' })
  await openDocument(page, 'pages', harbour.id)

  await suggestionNotice(page, '/harbour', '/marina').getByRole('button', { name: 'Yes, redirect them' }).click()

  await expect(suggestionNotice(page, '/harbour', '/marina')).toHaveCount(0)
  expect(await visit(visitor, '/harbour/boats')).toEqual({ location: '/marina/boats', status: 308 })
  await page.reload()
  await expect(page.locator('#field-title')).toBeEditable()
  await expect(suggestionNotice(page, '/harbour', '/marina')).toHaveCount(0)
})

test('changes a suggestion opened from its notice to an exact path that is on, which then offers only what an editor picks', async ({
  page,
  request,
  visitor
}) => {
  const orchard = await publish(request, 'pages', { slug: 'orchard', title: 'Orchard' })
  await publishChange(request, 'pages', orchard.id, { slug: 'vineyard' })
  const [suggestion] = await findRedirects(request, ['/orchard'])
  await openDocument(page, 'pages', orchard.id)

  await suggestionNotice(page, '/orchard', '/vineyard').getByRole('link', { name: 'Edit' }).click()

  await expect(page).toHaveURL(new RegExp(`/admin/collections/redirects/${suggestion!.id}$`))
  await expect(page.locator('#field-match .rs__single-value')).toHaveText('Path and subpaths')
  await expectOptions(page, 'match', ['Exact path', 'Path and subpaths', 'Regex'])
  await expectOptions(page, 'status', ['On', 'Off', 'Suggested'])

  await (await openOptions(page, 'match')).filter({ hasText: 'Exact path' }).click()
  await (await openOptions(page, 'status')).filter({ hasText: /^On$/ }).click()
  await page.locator('#action-save').click()

  await expect.poll(async () => (await findRedirects(request, ['/orchard']))[0]?.status).toBe('on')
  expect(await visit(visitor, '/orchard')).toEqual({ location: '/vineyard', status: 308 })
  expect(await visit(visitor, '/orchard/x')).toEqual({ status: 404 })
  await expectOptions(page, 'match', ['Exact path', 'Regex'])
  await expectOptions(page, 'status', ['On', 'Off'])
})

test('offers only Exact path and Regex, and On and Off, on a redirect an editor makes', async ({ page }) => {
  await page.goto('/admin/collections/redirects/create')

  await expectOptions(page, 'match', ['Exact path', 'Regex'])
  await expectOptions(page, 'status', ['On', 'Off'])
})

test('saves a URL an editor pasted with spaces around it, trimmed', async ({ page, request }) => {
  await page.goto('/admin/collections/redirects/create')

  await page.locator('#field-from').fill('/spring-sale')
  await page.locator('#field-to__type label').filter({ hasText: 'A URL' }).click()
  await page.locator('#field-to__url').fill('  https://example.com/spring  ')
  await page.locator('#action-save').click()

  await expect(page).toHaveURL(/\/admin\/collections\/redirects\/(?!create$)[^/]+$/)
  expect(await findRedirects(request, ['/spring-sale'])).toEqual([
    expect.objectContaining({ to: expect.objectContaining({ type: 'url', url: 'https://example.com/spring' }) })
  ])
})

test('deletes the suggestion once an editor says no on the moved page', async ({ page, request, visitor }) => {
  const bakery = await publish(request, 'pages', { slug: 'bakery', title: 'Bakery' })
  await publishChange(request, 'pages', bakery.id, { slug: 'bread' })
  await openDocument(page, 'pages', bakery.id)

  await suggestionNotice(page, '/bakery', '/bread').getByRole('button', { exact: true, name: 'No' }).click()

  await expect(suggestionNotice(page, '/bakery', '/bread')).toHaveCount(0)
  expect(await findRedirects(request, ['/bakery'])).toEqual([])
  expect(await visit(visitor, '/bakery')).toEqual({ status: 404 })
})

test('shows the notice as soon as a save in the admin moves the page', async ({ page, request }) => {
  const garden = await publish(request, 'pages', { slug: 'garden', title: 'Garden' })
  await openDocument(page, 'pages', garden.id)
  await expect(page.getByText('This page moved from')).toHaveCount(0)

  await page.getByRole('button', { exact: true, name: 'Unlock' }).click()
  await page.locator('#field-slug').fill('yard')
  await page.locator('#action-save').click()

  await expect(suggestionNotice(page, '/garden', '/yard')).toBeVisible()
  const noticeBox = await suggestionNotice(page, '/garden', '/yard').boundingBox()
  const titleBox = await page.locator('#field-title').boundingBox()
  expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(titleBox!.y)
})

test('changes nothing when an editor answers a notice someone else answered first', async ({ page, request, visitor }) => {
  const quay = await publish(request, 'pages', { slug: 'quay', title: 'Quay' })
  await publishChange(request, 'pages', quay.id, { slug: 'pier' })
  await openDocument(page, 'pages', quay.id)
  await expect(suggestionNotice(page, '/quay', '/pier')).toBeVisible()
  await acceptSuggestions(request, ['/quay'])

  await suggestionNotice(page, '/quay', '/pier').getByRole('button', { exact: true, name: 'No' }).click()

  await expect(suggestionNotice(page, '/quay', '/pier')).toHaveCount(0)
  expect(await findRedirects(request, ['/quay'])).toEqual([expect.objectContaining({ status: 'on' })])
  expect(await visit(visitor, '/quay')).toEqual({ location: '/pier', status: 308 })
})
