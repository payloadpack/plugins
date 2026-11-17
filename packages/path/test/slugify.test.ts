import { setTimeout as wait } from 'node:timers/promises'
import type { Slugify } from 'payload/shared'
import { expect, it } from 'vitest'

import { describeEachSetup } from './support/boot-payload.js'
import { create, readPath, update } from './support/documents.js'

// A site's own function, as it would give Payload's slug field: this one joins words with underscores.
const withUnderscores: Slugify = ({ valueToSlugify }) =>
  typeof valueToSlugify === 'string'
    ? valueToSlugify
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
    : undefined

// What the function below was given, by every test of every setup.
const given: Parameters<Slugify>[0][] = []

// The same for a site whose function waits for something.
const waiting: Slugify = async (args) => {
  await wait(1)
  given.push(args)
  return withUnderscores(args)
}

describeEachSetup("with a site's own slugify", { boot: { options: { slugify: withUnderscores } } }, (test, setup) => {
  it("makes the slug of a new document from its title with the site's function", async () => {
    const { payload } = test
    const hours = await create(payload, 'pages', { title: 'Opening Hours' })
    const notice = await create(payload, 'notices', { title: 'Lift Out Of Order' })

    expect(hours).toMatchObject({ path: '/opening_hours', slug: 'opening_hours' })
    expect(notice).toMatchObject({ path: '/lift_out_of_order', slug: 'lift_out_of_order' })
  })

  it("cleans a typed slug with the site's function, on a create and on a save", async () => {
    const { payload } = test
    const sale = await create(payload, 'pages', { slug: 'Summer Sale', title: 'Sale' })

    const renamed = await update(payload, 'pages', sale.id, { slug: 'Winter Sale' })

    expect(sale).toMatchObject({ path: '/summer_sale', slug: 'summer_sale' })
    expect(renamed).toMatchObject({ path: '/winter_sale', slug: 'winter_sale' })
  })

  it('gives an empty draft its slug from the title an autosave gives it, and keeps it when the title changes', async () => {
    const { payload } = test
    const { id } = await payload.create({ collection: 'pages', data: {}, depth: 0, draft: true, overrideAccess: true })

    const titled = await update(payload, 'pages', id, { title: 'Getting Here' }, { autosave: true, draft: true })
    const retitled = await update(payload, 'pages', id, { title: 'Find Us' }, { autosave: true, draft: true })

    expect([titled.slug, retitled.slug]).toEqual(['getting_here', 'getting_here'])
  })

  if (setup.localized) {
    it("cleans each locale's slug of a save in every locale at once", async () => {
      const { payload } = test
      const about = await create(payload, 'pages', { slug: 'about', title: 'About' })

      await update(payload, 'pages', about.id, { slug: { en: 'About Us', sv: 'Om Oss' } }, { locale: 'all' })

      expect(await readPath(payload, 'pages', about.id, { locale: 'en' })).toBe('/about_us')
      expect(await readPath(payload, 'pages', about.id, { locale: 'sv' })).toBe('/om_oss')
    })
  }
})

describeEachSetup("with a site's own slugify that waits", { boot: { options: { slugify: waiting } } }, (test) => {
  it('makes a slug from the title and cleans a typed one, with the document and the request of the save', async () => {
    const { payload } = test
    const fromTitle = await create(payload, 'pages', { title: 'Cup Final' })
    const typed = await create(payload, 'pages', { slug: 'Board Meeting', title: 'Meeting' })

    const renamed = await update(payload, 'pages', typed.id, { slug: 'Annual Meeting' })

    expect(fromTitle).toMatchObject({ path: '/cup_final', slug: 'cup_final' })
    expect(typed).toMatchObject({ path: '/board_meeting', slug: 'board_meeting' })
    expect(renamed).toMatchObject({ path: '/annual_meeting', slug: 'annual_meeting' })
    const fromRequest = given.filter(({ req }) => req.payload === payload)
    expect(fromRequest.find(({ valueToSlugify }) => valueToSlugify === 'Cup Final')?.data).toMatchObject({ title: 'Cup Final' })
  })
})
