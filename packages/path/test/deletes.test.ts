import { expect, it } from 'vitest'

import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, remove, update } from './support/documents.js'

describeEachSetup('', {}, (test, setup) => {
  it('gives a lifted document the path its own slug makes, whatever path it stored', async () => {
    const { payload } = test
    const arcade = await create(payload, 'pages', { slug: 'arcade', title: 'Arcade' })
    const kiosk = await create(payload, 'pages', { parent: arcade.id, slug: 'kiosk', title: 'Kiosk' })
    const stall = await create(payload, 'pages', { parent: arcade.id, slug: 'stall', title: 'Stall' })
    // Stored at a path that nothing the plugin writes leaves behind. A lift makes each path again from
    // the slug and the parent, so it never rewrites what a path starts with.
    const strayPath = '/arcade-annex/stall'
    const stored = await payload.db.findOne({ collection: 'pages', where: { id: { equals: stall.id } } })
    await payload.db.updateOne({
      collection: 'pages',
      data: { ...stored, path: setup.localized ? { en: strayPath, sv: strayPath } : strayPath },
      id: stall.id
    })

    await remove(payload, 'pages', arcade.id)

    expect(await readPath(payload, 'pages', kiosk.id)).toBe('/kiosk')
    expect(await readDocument(payload, 'pages', stall.id)).toMatchObject({ ancestors: [], path: '/stall' })
  })

  it('lifts the documents below a deleted page one level, with their ancestors, parent and latest versions', async () => {
    const { payload } = test
    const company = await create(payload, 'pages', { slug: 'company', title: 'Company' })
    const team = await create(payload, 'pages', { parent: company.id, slug: 'team', title: 'Team' })
    const people = await create(payload, 'pages', { parent: team.id, slug: 'people', title: 'People' })
    const hiring = await create(payload, 'pages', { parent: people.id, slug: 'hiring', title: 'Hiring' })
    const values = await create(payload, 'pages', { parent: team.id, slug: 'values', title: 'Values' })
    await update(payload, 'pages', values.id, { slug: 'our-values' }, { draft: true })

    await remove(payload, 'pages', team.id)

    expect(await readPath(payload, 'pages', people.id)).toBe('/company/people')
    expect(await readPath(payload, 'pages', hiring.id)).toBe('/company/people/hiring')
    expect(await readPath(payload, 'pages', values.id)).toBe('/company/values')
    expect(await readPath(payload, 'pages', values.id, { draft: true })).toBe('/company/our-values')
    const lifted = await readDocument(payload, 'pages', people.id)
    expect(String(lifted.parent)).toBe(String(company.id))
    expect(lifted.ancestors).toEqual([company.id])
    expect((await readDocument(payload, 'pages', hiring.id)).ancestors).toEqual([company.id, people.id])
    expect(String((await readDocument(payload, 'pages', values.id, { draft: true })).parent)).toBe(String(company.id))
  })

  it('lifts the posts below a deleted post within the posts, to the top level', async () => {
    const { payload } = test
    const archive = await create(payload, 'posts', { slug: 'archive', title: 'Archive' })
    const old = await create(payload, 'posts', { parent: archive.id, slug: 'old-news', title: 'Old news' })
    const photos = await create(payload, 'posts', { parent: old.id, slug: 'photos', title: 'Photos' })

    await remove(payload, 'posts', archive.id)

    expect(await readPath(payload, 'posts', old.id)).toBe('/old-news')
    expect(await readPath(payload, 'posts', photos.id)).toBe('/old-news/photos')
    expect((await readDocument(payload, 'posts', old.id)).parent).toBeFalsy()
    expect((await readDocument(payload, 'posts', old.id)).ancestors).toEqual([])
    expect((await readDocument(payload, 'posts', photos.id)).ancestors).toEqual([old.id])
  })

  it('lifts the documents below a deleted document of a collection without drafts', async () => {
    const { payload } = test
    const desk = await create(payload, 'notices', { slug: 'desk', title: 'Desk' })
    const lost = await create(payload, 'notices', { parent: desk.id, slug: 'lost', title: 'Lost' })
    const keys = await create(payload, 'notices', { parent: lost.id, slug: 'keys', title: 'Keys' })

    await remove(payload, 'notices', desk.id)

    expect(await readPath(payload, 'notices', lost.id)).toBe('/lost')
    expect(await readPath(payload, 'notices', keys.id)).toBe('/lost/keys')
    expect((await readDocument(payload, 'notices', keys.id)).ancestors).toEqual([lost.id])
  })

  it('refuses a delete whose child would take a path in use in another collection, and moves nothing', async () => {
    const { payload } = test
    await create(payload, 'posts', { slug: 'press', title: 'Press' })
    const media = await create(payload, 'pages', { slug: 'media', title: 'Media' })
    const press = await create(payload, 'pages', { parent: media.id, slug: 'press', title: 'Press kit' })

    expect(await catchFieldErrors(remove(payload, 'pages', media.id))).toMatchObject([
      { message: 'Post "Press" is already at /press, so change the slug or the parent.', path: 'slug' }
    ])
    expect(await readPath(payload, 'pages', press.id)).toBe('/media/press')
  })

  it("lets a child take its deleted parent's own path", async () => {
    const { payload } = test
    const careers = await create(payload, 'pages', { slug: 'careers', title: 'Careers' })
    const jobs = await create(payload, 'pages', { parent: careers.id, slug: 'careers', title: 'Jobs' })

    await remove(payload, 'pages', careers.id)

    expect(await readPath(payload, 'pages', jobs.id)).toBe('/careers')
  })

  it('refuses a delete that would lift a draft onto another document, or a document onto a draft', async () => {
    const { payload } = test
    await create(payload, 'pages', { slug: 'shop', title: 'Shop' })
    const outlet = await create(payload, 'pages', { slug: 'outlet', title: 'Outlet' })
    const draft = await create(payload, 'pages', { parent: outlet.id, slug: 'shop', title: 'Shop draft' }, { draft: true })
    await create(payload, 'pages', { slug: 'stock', title: 'Stock draft' }, { draft: true })
    const depot = await create(payload, 'pages', { slug: 'depot', title: 'Depot' })
    const stock = await create(payload, 'pages', { parent: depot.id, slug: 'stock', title: 'Stock' })

    expect(await catchFieldErrors(remove(payload, 'pages', outlet.id))).toMatchObject([
      { message: 'Page "Shop" is already at /shop, so change the slug or the parent.', path: 'slug' }
    ])
    expect(await catchFieldErrors(remove(payload, 'pages', depot.id))).toMatchObject([
      { message: 'Page "Stock draft" is already at /stock, so change the slug or the parent.', path: 'slug' }
    ])
    expect(await readPath(payload, 'pages', draft.id, { draft: true })).toBe('/outlet/shop')
    expect(await readPath(payload, 'pages', stock.id)).toBe('/depot/stock')
  })
})
