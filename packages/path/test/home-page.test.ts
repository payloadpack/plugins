import type { FilterOptionsProps, RelationshipField, Where } from 'payload'
import { beforeAll, expect, it } from 'vitest'

import type { Id } from '../src/paths/place.js'
import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, create, readPath, remove, update } from './support/documents.js'

describeEachSetup('', {}, (test) => {
  let home: Awaited<ReturnType<typeof create>>
  beforeAll(async () => {
    home = await create(test.payload, 'pages', { slug: 'home', title: 'Home' })
  })

  it('puts the top-level page with the root slug at /', async () => {
    expect(await readPath(test.payload, 'pages', home.id)).toBe('/')
  })

  it('refuses the home page as the parent of a page', async () => {
    expect(
      await catchFieldErrors(create(test.payload, 'pages', { parent: home.id, slug: 'about', title: 'About' }))
    ).toMatchObject([{ message: "The home page can't hold pages, so pick another parent.", path: 'parent' }])
  })

  it('offers neither the document itself nor the home page as a parent in the picker, and still refuses both on a save', async () => {
    const { payload } = test
    const gallery = await create(payload, 'pages', { slug: 'gallery', title: 'Gallery' })
    const prints = await create(payload, 'pages', { parent: gallery.id, slug: 'prints', title: 'Prints' })
    const { filterOptions } = payload.collections.pages.config.fields.find(
      (field) => 'name' in field && field.name === 'parent'
    ) as RelationshipField
    // The documents the picker offers, for a document that exists and for a new one, which has no id.
    const offered = async (id?: Id) => {
      const where = await (filterOptions as (options: FilterOptionsProps) => unknown)({
        id,
        relationTo: 'pages'
      } as FilterOptionsProps)
      const { docs } = await payload.find({
        collection: 'pages',
        depth: 0,
        overrideAccess: true,
        pagination: false,
        where: where as Where
      })
      return docs.map((document) => document.id)
    }

    expect(await offered(gallery.id)).toEqual([prints.id])
    expect((await offered()).sort()).toEqual([gallery.id, prints.id].sort())
    // Payload checks a chosen parent against the picker's filter after the plugin's own check.
    expect(await catchFieldErrors(update(payload, 'pages', gallery.id, { parent: gallery.id }))).toMatchObject([
      { message: "A document can't sit below itself, so pick another parent.", path: 'parent' }
    ])
    expect(await catchFieldErrors(update(payload, 'pages', gallery.id, { parent: prints.id }))).toMatchObject([
      { message: "A document can't sit below itself, so pick another parent.", path: 'parent' }
    ])
    expect(await catchFieldErrors(update(payload, 'pages', gallery.id, { parent: home.id }))).toMatchObject([
      { message: "The home page can't hold pages, so pick another parent.", path: 'parent' }
    ])
  })

  it('keeps / for one published document, whichever collection without a base path holds it', async () => {
    const { payload } = test
    const welcome = await create(payload, 'posts', { slug: 'welcome', title: 'Welcome' })
    const homePost = await create(payload, 'posts', { parent: welcome.id, slug: 'home', title: 'Home post' })

    expect(await catchFieldErrors(create(payload, 'posts', { slug: 'home', title: 'Home post' }))).toMatchObject([
      { message: 'Page "Home" is already at this path, so change the slug or the parent.', path: 'slug' }
    ])
    // Only a top-level document answers /.
    expect(await readPath(payload, 'posts', homePost.id)).toBe('/welcome/home')
  })

  it('refuses to rename a page that holds others to the root slug', async () => {
    const { payload } = test
    const tour = await create(payload, 'pages', { slug: 'tour', title: 'Tour' })
    await create(payload, 'pages', { parent: tour.id, slug: 'stops', title: 'Stops' })

    expect(await catchFieldErrors(update(payload, 'pages', tour.id, { slug: 'home' }, { draft: true }))).toMatchObject([
      { message: "The home page can't hold pages, so move the ones under this page first.", path: 'slug' }
    ])
  })

  it('refuses a delete that would make a child page the home page', async () => {
    const { payload } = test
    const start = await create(payload, 'pages', { slug: 'start', title: 'Start' })
    await create(payload, 'pages', { parent: start.id, slug: 'home', title: 'Start home' })

    expect(await catchFieldErrors(remove(payload, 'pages', start.id))).toMatchObject([
      { message: 'Page "Start home" would become the home page at /, so change its slug first.', path: 'slug' }
    ])
  })
})

describeEachSetup('with rootSlug', { boot: { options: { rootSlug: 'start' } } }, (test) => {
  it('puts the top-level page with the configured slug at /', async () => {
    const { payload } = test
    const start = await create(payload, 'pages', { slug: 'start', title: 'Start' })
    const home = await create(payload, 'pages', { slug: 'home', title: 'Home' })

    expect(await readPath(payload, 'pages', start.id)).toBe('/')
    expect(await readPath(payload, 'pages', home.id)).toBe('/home')
  })
})
