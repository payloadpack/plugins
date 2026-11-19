import type { CollectionConfig } from 'payload'
import { beforeEach, expect, it } from 'vitest'

import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, readRows, remove, update } from './support/documents.js'

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

// The guides a site's own beforeDelete refuses to delete, and the ones whose delete it holds back for
// a moment. The plugin lifts the documents below after the collection's own beforeDelete hooks, so a
// delete they refuse moves nothing, and in a bulk delete the lift of a held guide comes last.
const keptGuides = new Set<string>()
const heldGuides = new Set<string>()

const guidesWithSiteHook = (localized: boolean): CollectionConfig => ({
  ...titled('guides', localized),
  hooks: {
    beforeDelete: [
      async ({ id }) => {
        if (keptGuides.has(String(id))) throw new Error('The site keeps this guide.')
        if (heldGuides.has(String(id))) await new Promise((resolve) => setTimeout(resolve, 500))
      }
    ]
  }
})

for (const transactions of [true, false]) {
  describeEachSetup(
    `with a site's own beforeDelete, transactions ${transactions ? 'on' : 'off'}`,
    {
      boot: (setup) => ({
        collections: [guidesWithSiteHook(setup.localized)],
        options: { collections: ['pages', 'posts', 'notices', 'guides'] },
        transactions
      })
    },
    (test) => {
      beforeEach(() => {
        keptGuides.clear()
        heldGuides.clear()
      })

      it("keeps the documents below a document where they were when the site's own hook refuses its delete", async () => {
        const { payload } = test
        const manual = await create(payload, 'guides', { slug: 'manual', title: 'Manual' })
        const setupGuide = await create(payload, 'guides', { parent: manual.id, slug: 'setup', title: 'Setup' })
        const wiring = await create(payload, 'guides', { parent: setupGuide.id, slug: 'wiring', title: 'Wiring' })
        keptGuides.add(String(manual.id))
        const before = await readRows(payload, 'guides', [manual.id, setupGuide.id, wiring.id])

        await expect(remove(payload, 'guides', manual.id)).rejects.toThrow('The site keeps this guide.')

        expect(await readRows(payload, 'guides', [manual.id, setupGuide.id, wiring.id])).toEqual(before)
      })

      it("keeps the documents below a document where they were when the site's own hook refuses its delete in a bulk delete, and deletes the other", async () => {
        const { payload } = test
        const handbook = await create(payload, 'guides', { slug: 'handbook', title: 'Handbook' })
        const safety = await create(payload, 'guides', { parent: handbook.id, slug: 'safety', title: 'Safety' })
        const drills = await create(payload, 'guides', { parent: safety.id, slug: 'drills', title: 'Drills' })
        const leaflet = await create(payload, 'guides', { slug: 'leaflet', title: 'Leaflet' })
        const folds = await create(payload, 'guides', { parent: leaflet.id, slug: 'folds', title: 'Folds' })
        keptGuides.add(String(handbook.id))
        const before = await readRows(payload, 'guides', [handbook.id, safety.id, drills.id])

        const { errors } = await payload.delete({
          collection: 'guides',
          overrideAccess: true,
          where: { id: { in: [handbook.id, leaflet.id] } }
        })

        expect(errors).toMatchObject([{ id: handbook.id, message: 'The site keeps this guide.' }])
        expect(await readRows(payload, 'guides', [handbook.id, safety.id, drills.id])).toEqual(before)
        expect(await readPath(payload, 'guides', folds.id)).toBe('/folds')
      })

      // The site hears the lifts in any order, so each names where a document ended up.
      for (const held of ['parent', 'parent above'] as const) {
        it(`lifts a document to the top level when one bulk delete deletes its parent and the parent above that, with the lift from the ${held} last, and tells the site where it went`, async () => {
          const { changes, payload } = test
          const name = held === 'parent' ? 'mill' : 'forge'
          const top = await create(payload, 'guides', { slug: `${name}-top`, title: 'Top' })
          const middle = await create(payload, 'guides', { parent: top.id, slug: `${name}-middle`, title: 'Middle' })
          const low = await create(payload, 'guides', { parent: middle.id, slug: `${name}-low`, title: 'Low' })
          heldGuides.add(String(held === 'parent' ? middle.id : top.id))
          changes.length = 0

          const { errors } = await payload.delete({
            collection: 'guides',
            overrideAccess: true,
            where: { id: { in: [top.id, middle.id] } }
          })

          const lifted = await readDocument(payload, 'guides', low.id)
          const reportedTo = changes
            .flat()
            .filter(({ id }) => String(id) === String(low.id))
            .map(({ to }) => to)
          expect({
            ancestors: lifted.ancestors,
            draftPath: await readPath(payload, 'guides', low.id, { draft: true }),
            errors,
            lastReportedTo: reportedTo.at(-1),
            parent: lifted.parent ?? null,
            path: lifted.path
          }).toEqual({
            ancestors: [],
            draftPath: `/${name}-low`,
            errors: [],
            lastReportedTo: `/${name}-low`,
            parent: null,
            path: `/${name}-low`
          })
          // The delete above lifted the parent and its own delete removed it, so the site hears both.
          const reportedOfParent = changes
            .flat()
            .filter(({ id }) => String(id) === String(middle.id))
            .map(({ to }) => to)
          expect(reportedOfParent).toHaveLength(2)
          expect(reportedOfParent).toEqual(expect.arrayContaining([null, `/${name}-middle`]))
        })
      }
    }
  )
}
