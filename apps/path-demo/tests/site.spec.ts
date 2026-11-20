import { expect, test, type Page } from '@playwright/test'

// The demo's page of a site, which finds the document at the path a visitor asks for with findByPath.
const heading = (page: Page) => page.getByRole('heading', { level: 1 })

test.describe('a visitor who is not logged in', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('sees the published document at a path, and no draft, even when asking for one', async ({ page }) => {
    await page.goto('/about/team')
    await expect(heading(page)).toHaveText('Team')

    expect((await page.goto('/blog/coming-soon?draft=true'))?.status()).toBe(404)
  })
})

test('shows a logged-in user the draft at a path only when asked for one', async ({ page }) => {
  expect((await page.goto('/blog/coming-soon'))?.status()).toBe(404)

  await page.goto('/blog/coming-soon?draft=true')
  await expect(heading(page)).toHaveText('Coming soon')
})
