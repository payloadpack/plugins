import { expect, test } from '@playwright/test'

import {
  createDraft,
  createPublished,
  findPublishedAt,
  findSeededPage,
  openDocument,
  openNewDocument,
  pathField,
  pickParentTopic,
  publish,
  publishInSwedish,
  refreshSlug,
  slugField,
  unlockSlug
} from './demo'

test('gives a new page its slug and path from the title an editor types, and a site finds it once it is published', async ({
  page
}) => {
  const id = await openNewDocument(page, 'pages')
  await expect(slugField(page)).toBeDisabled()
  await expect(slugField(page)).toHaveValue('')

  // The autosave that follows the typing gives the page its slug, and with it its path.
  await page.locator('#field-title').fill('Winter opening hours')

  await expect(slugField(page)).toHaveValue('winter-opening-hours')
  await expect(pathField(page)).toHaveValue('/winter-opening-hours')
  expect(await findPublishedAt(page.request, '/winter-opening-hours')).toBeNull()

  await publish(page)

  await expect
    .poll(() => findPublishedAt(page.request, '/winter-opening-hours'))
    .toMatchObject({
      collection: 'pages',
      document: { id, title: 'Winter opening hours' }
    })
})

test('keeps the slug locked until an editor unlocks it, and saves a typed slug cleaned, with the path', async ({ page }) => {
  const cellar = await createPublished(page.request, 'pages', { slug: 'cellar', title: 'Cellar' })
  await openDocument(page, 'pages', cellar.id)
  await expect(slugField(page)).toBeDisabled()
  await expect(slugField(page)).toHaveValue('cellar')
  await expect(refreshSlug(page)).toBeHidden()

  await unlockSlug(page)
  await expect(refreshSlug(page)).toBeVisible()
  await slugField(page).fill('Wine Cellar!')
  await publish(page)

  await expect(slugField(page)).toHaveValue('wine-cellar')
  await expect(pathField(page)).toHaveValue('/wine-cellar')
  await page.getByRole('button', { exact: true, name: 'Lock' }).click()
  await expect(slugField(page)).toBeDisabled()
})

test("makes the slug from the title when an editor presses refresh, by the plugin's own rules", async ({ page }) => {
  const about = await createPublished(page.request, 'pages', { slug: 'who-we-are', title: 'Över oss' })
  await openDocument(page, 'pages', about.id)
  await expect(slugField(page)).toHaveValue('who-we-are')

  // Payload's own slugify would drop the Ö. The button runs the one the plugin gave the field.
  await unlockSlug(page)
  await refreshSlug(page).click()

  await expect(slugField(page)).toHaveValue('over-oss')
  await publish(page)
  await expect(pathField(page)).toHaveValue('/over-oss')
})

test('shows the path a page is published at, and moves the pages below it with a rename', async ({ page }) => {
  const garden = await createPublished(page.request, 'pages', { slug: 'garden', title: 'Garden' })
  const roses = await createPublished(page.request, 'pages', { parent: garden.id, slug: 'roses', title: 'Roses' })
  await openDocument(page, 'pages', garden.id)
  await expect(pathField(page)).toHaveValue('/garden')

  await unlockSlug(page)
  await slugField(page).fill('yard')
  await publish(page)

  await expect(pathField(page)).toHaveValue('/yard')
  await openDocument(page, 'pages', roses.id)
  await expect(pathField(page)).toHaveValue('/yard/roses')
})

test('moves a page below another page', async ({ page }) => {
  await createPublished(page.request, 'pages', { slug: 'shelf', title: 'Shelf' })
  const box = await createPublished(page.request, 'pages', { slug: 'box', title: 'Box' })
  await openDocument(page, 'pages', box.id)

  // The list shows ten pages at a time, so the test searches for the one it wants.
  await page.locator('#field-parent').click()
  await page.keyboard.type('Shelf')
  await page.getByRole('option', { exact: true, name: 'Shelf' }).click()
  await publish(page)

  await expect(pathField(page)).toHaveValue('/shelf/box')
})

test('refuses a slug at a path a post holds below its base path, and names that post', async ({ page }) => {
  const planA = await createPublished(page.request, 'posts', { slug: 'plans', title: 'Plan A' })
  expect(planA.path).toBe('/blog/plans')
  const blog = await findSeededPage(page.request, 'blog')
  const planB = await createPublished(page.request, 'pages', { parent: blog.id, slug: 'plan-b', title: 'Plan B' })
  await openDocument(page, 'pages', planB.id)

  await unlockSlug(page)
  await slugField(page).fill('plans')
  await publish(page)

  await expect(page.getByText('Post "Plan A" is already at this path, so change the slug or the parent.').first()).toBeVisible()
  await page.reload()
  await expect(pathField(page)).toHaveValue('/blog/plan-b')
})

test('gives a new post its path at the base path, with no parent to pick', async ({ page }) => {
  await openNewDocument(page, 'posts')

  await page.locator('#field-title').fill('Quarterly numbers')

  await expect(pathField(page)).toHaveValue('/blog/quarterly-numbers')
  await expect(page.locator('#field-parent')).toHaveCount(0)
})

test("moves a topic below another topic with Payload's own button, with the topic below it", async ({ page }) => {
  await createPublished(page.request, 'topics', { slug: 'rivers', title: 'Rivers' })
  const lakes = await createPublished(page.request, 'topics', { slug: 'lakes', title: 'Lakes' })
  const fish = await createPublished(page.request, 'topics', { _h_topics: lakes.id, slug: 'fish', title: 'Fish' })
  await openDocument(page, 'topics', lakes.id)
  await expect(pathField(page)).toHaveValue('/topics/lakes')

  await pickParentTopic(page, 'Rivers')
  await publish(page)

  await expect(pathField(page)).toHaveValue('/topics/rivers/lakes')
  await openDocument(page, 'topics', fish.id)
  await expect(pathField(page)).toHaveValue('/topics/rivers/lakes/fish')
})

test('shows the refusal of a parent a topic cannot sit below, though the form has no field for the parent', async ({ page }) => {
  // A title with no letter or digit makes no slug, so this draft has no path yet.
  await createDraft(page.request, 'topics', { title: '???' })
  const tides = await createPublished(page.request, 'topics', { slug: 'tides', title: 'Tides' })
  await openDocument(page, 'topics', tides.id)

  await pickParentTopic(page, '???')
  await publish(page)

  await expect(page.getByText('The parent has no path yet, so save the parent first.').first()).toBeVisible()
  await page.reload()
  await expect(pathField(page)).toHaveValue('/topics/tides')
})

// Tagged, so playwright.config.ts runs it only on the localized demo.
test(
  'gives the Swedish version a path of its own, below the Swedish path of its parent',
  { tag: '@localized' },
  async ({ page }) => {
    const kitchen = await createPublished(page.request, 'pages', { slug: 'kitchen', title: 'Kitchen' })
    const knives = await createPublished(page.request, 'pages', { parent: kitchen.id, slug: 'knives', title: 'Knives' })
    await openDocument(page, 'pages', kitchen.id, 'sv')

    // Refresh makes the slug from the title of the locale the editor is in.
    await page.locator('#field-title').fill('Kök')
    await unlockSlug(page)
    await refreshSlug(page).click()
    await expect(slugField(page)).toHaveValue('kok')
    await publish(page)

    await expect(pathField(page)).toHaveValue('/kok')
    await openDocument(page, 'pages', knives.id, 'sv')
    await expect(pathField(page)).toHaveValue('/kok/knives')
    await openDocument(page, 'pages', knives.id, 'en')
    await expect(pathField(page)).toHaveValue('/kitchen/knives')
  }
)

test(
  'gives a topic the slug an editor types in Swedish in English too, with the one path and the topic below it',
  { tag: '@localized' },
  async ({ page }) => {
    const lagoon = await createPublished(page.request, 'topics', { slug: 'lagoon', title: 'Lagoon' })
    const reeds = await createPublished(page.request, 'topics', { _h_topics: lagoon.id, slug: 'reeds', title: 'Reeds' })
    await openDocument(page, 'topics', lagoon.id, 'sv')

    await page.locator('#field-title').fill('Lagun')
    await unlockSlug(page)
    await slugField(page).fill('lagun')
    await publish(page)

    await expect(pathField(page)).toHaveValue('/topics/lagun')
    await openDocument(page, 'topics', lagoon.id, 'en')
    await expect(slugField(page)).toHaveValue('lagun')
    await expect(pathField(page)).toHaveValue('/topics/lagun')
    await openDocument(page, 'topics', reeds.id, 'en')
    await expect(pathField(page)).toHaveValue('/topics/lagun/reeds')
  }
)

test(
  'shows an editor in Swedish the refusal of a slug whose path a page is at in English only',
  { tag: '@localized' },
  async ({ page }) => {
    const section = await createPublished(page.request, 'pages', { slug: 'topics', title: 'Topics' })
    const marsh = await createPublished(page.request, 'pages', { parent: section.id, slug: 'marsh', title: 'Marsh' })
    await publishInSwedish(page.request, 'pages', marsh.id, { slug: 'karr', title: 'Kärr' })
    const pond = await createPublished(page.request, 'topics', { slug: 'pond', title: 'Pond' })
    await openDocument(page, 'topics', pond.id, 'sv')

    await page.locator('#field-title').fill('Damm')
    await unlockSlug(page)
    await slugField(page).fill('marsh')
    await publish(page)

    await expect(
      page.getByText('Page "Marsh" is already at /topics/marsh in en, so change the slug or the parent.').first()
    ).toBeVisible()
    await page.reload()
    await expect(pathField(page)).toHaveValue('/topics/pond')
  }
)
