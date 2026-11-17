import { beforeEach, expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, restoreVersion, update } from './support/documents.js'

const takenBy = (document: string) => [
  { message: `${document} is already at this path, so change the slug or the parent.`, path: 'slug' }
]

describeEachSetup('', {}, (test, setup) => {
  beforeEach(() => {
    test.changes.length = 0
  })

  // Without localization a changed path has no locale; with it, the locale it belongs to.
  const at = (path: string) => (setup.localized ? { locale: 'en', path } : { path })
  // Where a branch went. With localization Swedish falls back to the English slug, so it went there too.
  const fromTo = (from: string, to: string) =>
    setup.localized ? ['en', 'sv'].map((locale) => ({ from, locale, to })) : [{ from, to }]

  it('moves the documents below a page when its rename is published, not when it is saved as a draft', async () => {
    const { payload } = test
    const menu = await create(payload, 'pages', { slug: 'menu', title: 'Menu' })
    const lunch = await create(payload, 'pages', { parent: menu.id, slug: 'lunch', title: 'Lunch' })

    await update(payload, 'pages', menu.id, { slug: 'food' }, { draft: true })
    expect(await readPath(payload, 'pages', menu.id, { draft: true })).toBe('/food')
    expect(await readPath(payload, 'pages', lunch.id)).toBe('/menu/lunch')

    await update(payload, 'pages', menu.id, {})
    expect(await readPath(payload, 'pages', menu.id)).toBe('/food')
    expect(await readPath(payload, 'pages', lunch.id)).toBe('/food/lunch')
  })

  it('moves a draft below a document while its published document sits elsewhere', async () => {
    const { payload } = test
    const shore = await create(payload, 'posts', { slug: 'shore', title: 'Shore' })
    const beach = await create(payload, 'posts', { slug: 'beach', title: 'Beach' })
    const shells = await create(payload, 'posts', { parent: shore.id, slug: 'shells', title: 'Shells' })
    await update(payload, 'posts', shells.id, { parent: beach.id }, { draft: true })

    await update(payload, 'posts', beach.id, { slug: 'sand' })

    const published = await readDocument(payload, 'posts', shells.id)
    expect(published.path).toBe('/shore/shells')
    // The post itself keeps the parent it was published below until the move happens.
    expect(String(published.parent)).toBe(String(shore.id))
    expect(await readPath(payload, 'posts', shells.id, { draft: true })).toBe('/sand/shells')
  })

  it('moves the documents below a page when a draft version is restored to the page itself', async () => {
    const { payload } = test
    const quay = await create(payload, 'pages', { slug: 'quay', title: 'Quay' })
    const boats = await create(payload, 'pages', { parent: quay.id, slug: 'boats', title: 'Boats' })
    await update(payload, 'pages', quay.id, { slug: 'mooring' }, { draft: true })
    await update(payload, 'pages', quay.id, { slug: 'quay' }, { draft: true })

    // A restore without draft writes the version to the page itself, with the status the version has.
    await restoreVersion(payload, 'pages', quay.id, { version: 1 })

    expect(await readPath(payload, 'pages', quay.id)).toBe('/mooring')
    expect(await readPath(payload, 'pages', boats.id)).toBe('/mooring/boats')
    expect(await readPath(payload, 'pages', boats.id, { draft: true })).toBe('/mooring/boats')

    await update(payload, 'pages', quay.id, {})
    await update(payload, 'pages', quay.id, { slug: 'berth' })

    expect(await readPath(payload, 'pages', boats.id)).toBe('/berth/boats')
    expect(await readPath(payload, 'pages', boats.id, { draft: true })).toBe('/berth/boats')
  })

  it('moves the documents below a page that was never published when a save without draft renames it', async () => {
    const { payload } = test
    const loft = await create(payload, 'pages', { slug: 'loft', title: 'Loft' }, { draft: true })
    const beams = await create(payload, 'pages', { parent: loft.id, slug: 'beams', title: 'Beams' }, { draft: true })

    // Without draft, Payload writes the page itself, and it stays a draft.
    await payload.update({ collection: 'pages', data: { slug: 'attic' }, id: loft.id, overrideAccess: true })

    expect(await readPath(payload, 'pages', loft.id)).toBe('/attic')
    expect(await readPath(payload, 'pages', beams.id)).toBe('/attic/beams')
    expect(await readPath(payload, 'pages', beams.id, { draft: true })).toBe('/attic/beams')

    await update(payload, 'pages', loft.id, {})
    await update(payload, 'pages', loft.id, { slug: 'garret' })

    expect(await readPath(payload, 'pages', beams.id)).toBe('/garret/beams')
    expect(await readPath(payload, 'pages', beams.id, { draft: true })).toBe('/garret/beams')
  })

  it('moves the documents below a page with a renamed draft when the page is unpublished, and says so', async () => {
    const { changes, payload } = test
    const stage = await create(payload, 'pages', { slug: 'stage', title: 'Stage' })
    const lights = await create(payload, 'pages', { parent: stage.id, slug: 'lights', title: 'Lights' })
    await update(payload, 'pages', stage.id, { slug: 'platform' }, { draft: true })
    changes.length = 0

    // As the admin's Unpublish button saves: the status alone, without draft, so Payload writes the
    // draft to the page itself.
    await payload.update({ collection: 'pages', data: { _status: 'draft' }, id: stage.id, overrideAccess: true })

    expect(await readPath(payload, 'pages', stage.id)).toBe('/platform')
    expect(await readPath(payload, 'pages', lights.id)).toBe('/platform/lights')
    expect(changes).toEqual([
      {
        moved: { collection: 'pages', documentsBelow: 1, id: stage.id, paths: fromTo('/stage', '/platform') },
        paths: [at('/stage')]
      }
    ])

    await update(payload, 'pages', stage.id, {})
    await update(payload, 'pages', stage.id, { slug: 'podium' })

    expect(await readPath(payload, 'pages', stage.id)).toBe('/podium')
    expect(await readPath(payload, 'pages', lights.id)).toBe('/podium/lights')
    expect(await readPath(payload, 'pages', lights.id, { draft: true })).toBe('/podium/lights')
  })

  it('moves the documents below a page with a renamed draft when a save without draft changes another field', async () => {
    const { payload } = test
    const porch = await create(payload, 'pages', { slug: 'porch', title: 'Porch' })
    const steps = await create(payload, 'pages', { parent: porch.id, slug: 'steps', title: 'Steps' })
    await update(payload, 'pages', porch.id, { slug: 'veranda' }, { draft: true })

    await payload.update({ collection: 'pages', data: { title: 'Front porch' }, id: porch.id, overrideAccess: true })

    expect(await readPath(payload, 'pages', porch.id)).toBe('/veranda')
    expect(await readPath(payload, 'pages', steps.id)).toBe('/veranda/steps')

    await update(payload, 'pages', porch.id, { slug: 'deck' })

    expect(await readPath(payload, 'pages', steps.id)).toBe('/deck/steps')
  })

  it('moves nothing published when a draft with a new slug is saved with a select that leaves the status out', async () => {
    const { changes, payload } = test
    const depot = await create(payload, 'pages', { slug: 'depot', title: 'Depot' })
    const crates = await create(payload, 'pages', { parent: depot.id, slug: 'crates', title: 'Crates' })
    changes.length = 0

    await payload.update({
      collection: 'pages',
      data: { slug: 'store' },
      draft: true,
      id: depot.id,
      overrideAccess: true,
      select: { title: true }
    })

    expect(await readPath(payload, 'pages', depot.id)).toBe('/depot')
    expect(await readPath(payload, 'pages', depot.id, { draft: true })).toBe('/store')
    expect(await readPath(payload, 'pages', crates.id)).toBe('/depot/crates')
    expect(changes).toEqual([])

    // The publish that carries the move out leaves the status out as well.
    await payload.update({
      collection: 'pages',
      data: { _status: 'published' },
      id: depot.id,
      overrideAccess: true,
      select: { title: true }
    })

    expect(await readPath(payload, 'pages', crates.id)).toBe('/store/crates')
    expect(changes).toEqual([
      {
        moved: { collection: 'pages', documentsBelow: 1, id: depot.id, paths: fromTo('/depot', '/store') },
        paths: [at('/store'), at('/depot')]
      }
    ])
  })

  it('reports a publish that keeps the slug and the parent, and no draft save, when a select leaves the status out', async () => {
    const { changes, payload } = test
    const annexe = await create(payload, 'pages', { slug: 'annexe', title: 'Annexe' })
    const save = (data: Record<string, unknown>, draft: boolean, select: Record<string, true>) =>
      payload.update({ collection: 'pages', data, draft, id: annexe.id, overrideAccess: true, select })
    changes.length = 0

    await save({ title: 'Annexe draft' }, true, { path: true })
    expect(changes).toEqual([])

    // The first publish is one of a draft, and the second keeps a published page as it is. The
    // result of the second holds no path either.
    await save({ _status: 'published', title: 'The annexe' }, false, { path: true })
    await save({ _status: 'published', title: 'Annexe' }, false, { title: true })
    expect(changes).toEqual([{ paths: [at('/annexe')] }, { paths: [at('/annexe')] }])
  })

  it('lets the drafts of two published pages plan one free path, and refuses the second publish', async () => {
    const { payload } = test
    const first = await create(payload, 'posts', { slug: 'gallery-one', title: 'Gallery one' })
    const second = await create(payload, 'posts', { slug: 'gallery-two', title: 'Gallery two' })

    // A plan takes nothing, so both drafts save.
    await update(payload, 'posts', first.id, { slug: 'gallery' }, { draft: true })
    await update(payload, 'posts', second.id, { slug: 'gallery' }, { draft: true })
    await update(payload, 'posts', first.id, {})

    expect(await catchFieldErrors(update(payload, 'posts', second.id, {}))).toMatchObject(takenBy('Post "Gallery one"'))
    expect(await readPath(payload, 'posts', first.id)).toBe('/gallery')
    expect(await readPath(payload, 'posts', second.id)).toBe('/gallery-two')
  })

  it('refuses the draft of a published page that plans a path another document is at', async () => {
    const { payload } = test
    await create(payload, 'pages', { slug: 'events', title: 'Events' }, { draft: true })
    const diary = await create(payload, 'posts', { slug: 'diary', title: 'Diary' })

    expect(await catchFieldErrors(update(payload, 'posts', diary.id, { slug: 'events' }, { draft: true }))).toMatchObject(
      takenBy('Page "Events"')
    )
    expect(await readPath(payload, 'posts', diary.id, { draft: true })).toBe('/diary')
  })

  it('refuses a draft and an autosave that move a post onto a published path', async () => {
    const { payload } = test
    await create(payload, 'pages', { slug: 'specials', title: 'Specials' })
    const lunch = await create(payload, 'posts', { slug: 'lunch-specials', title: 'Lunch specials' }, { draft: true })

    expect(await catchFieldErrors(update(payload, 'posts', lunch.id, { slug: 'specials' }, { draft: true }))).toMatchObject(
      takenBy('Page "Specials"')
    )
    expect(
      await catchFieldErrors(update(payload, 'posts', lunch.id, { slug: 'specials' }, { autosave: true, draft: true }))
    ).toMatchObject(takenBy('Page "Specials"'))
  })

  it('finds a published document only, unless draft is set', async () => {
    const { payload } = test
    await create(payload, 'posts', { slug: 'sketch', title: 'Sketch' }, { draft: true })
    const gazette = await create(payload, 'posts', { slug: 'gazette', title: 'Gazette' })
    await update(payload, 'posts', gazette.id, { slug: 'gazette-soon' }, { draft: true })

    expect(await findByPath({ path: '/sketch', payload })).toBeNull()
    expect(await findByPath({ path: '/gazette', payload })).toMatchObject({ document: { id: gazette.id } })
  })

  it('finds the latest draft at a path when draft is set', async () => {
    const { payload } = test
    const plan = await create(payload, 'posts', { slug: 'plan', title: 'Plan' }, { draft: true })
    const live = await create(payload, 'posts', { slug: 'live', title: 'Live' })
    await update(payload, 'posts', live.id, { slug: 'live-soon' }, { draft: true })

    expect(await findByPath({ draft: true, path: '/plan', payload })).toMatchObject({ document: { id: plan.id } })
    expect(await findByPath({ draft: true, path: '/live-soon', payload })).toMatchObject({ document: { id: live.id } })
  })
})
