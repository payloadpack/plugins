import { createPayloadRequest, type CollectionSlug, type Payload } from 'payload'
import { beforeEach, expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { findDocumentAndLatestVersion, findParentAndBuildPathAndAncestors } from '../src/database/versions.js'
import { getStoredPathAndAncestors, type Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, changed, create, readDocument, restoreVersion, update } from './support/documents.js'

// Built by the one rule from what the database holds, which the document and its latest version must
// store too.
async function readPathAndAncestors(payload: Payload, collection: CollectionSlug, id: Id) {
  const req = await createPayloadRequest({ payload })
  const { config } = payload.collections[collection]
  const stored = (await findDocumentAndLatestVersion(config, id, req))!
  const document = await findParentAndBuildPathAndAncestors(stored, 'document', config, req)
  const draft = await findParentAndBuildPathAndAncestors(stored, 'draft', config, req)
  expect(getStoredPathAndAncestors(stored.document, collection, payload)).toEqual(document)
  if (stored.version) expect(getStoredPathAndAncestors(stored.version.version, collection, payload)).toEqual(draft)
  return { document, draft }
}

describeEachSetup('', {}, (test, setup) => {
  beforeEach(() => {
    test.changes.length = 0
  })

  // Without localization there is one path, under no locale.
  const paths = (english: string, swedish = english) => (setup.localized ? { en: english, sv: swedish } : { '': english })
  const takenBy = (document: string) => [
    { message: `${document} is already at this path, so change the slug or the parent.`, path: 'slug' }
  ]

  it('moves a page that was never published at once when a draft renames it, with the page below it', async () => {
    const { changes, payload } = test
    const loft = await create(payload, 'pages', { slug: 'loft', title: 'Loft' }, { draft: true })
    const beams = await create(payload, 'pages', { parent: loft.id, slug: 'beams', title: 'Beams' }, { draft: true })
    changes.length = 0

    await update(payload, 'pages', loft.id, { slug: 'attic' }, { draft: true })

    expect(await readPathAndAncestors(payload, 'pages', loft.id)).toEqual({
      document: { ancestors: [], paths: paths('/attic') },
      draft: { ancestors: [], paths: paths('/attic') }
    })
    expect(await readPathAndAncestors(payload, 'pages', beams.id)).toEqual({
      document: { ancestors: [loft.id], paths: paths('/attic/beams') },
      draft: { ancestors: [loft.id], paths: paths('/attic/beams') }
    })
    // Nothing published changed, so the site hears nothing.
    expect(changes).toEqual([])
    expect((await create(payload, 'pages', { slug: 'loft', title: 'New loft' })).path).toBe('/loft')
    expect(await catchFieldErrors(create(payload, 'pages', { slug: 'attic', title: 'New attic' }))).toMatchObject(
      takenBy('Page "Loft"')
    )
  })

  it('moves a page that was never published at once when a draft gives it another parent, with the page below it', async () => {
    const { changes, payload } = test
    const roof = await create(payload, 'pages', { slug: 'roof', title: 'Roof' }, { draft: true })
    const tiles = await create(payload, 'pages', { slug: 'tiles', title: 'Tiles' }, { draft: true })
    const moss = await create(payload, 'pages', { parent: tiles.id, slug: 'moss', title: 'Moss' }, { draft: true })
    changes.length = 0

    await update(payload, 'pages', tiles.id, { parent: roof.id }, { draft: true })

    expect(await readPathAndAncestors(payload, 'pages', tiles.id)).toEqual({
      document: { ancestors: [roof.id], paths: paths('/roof/tiles') },
      draft: { ancestors: [roof.id], paths: paths('/roof/tiles') }
    })
    // Payload wrote the draft to the latest version only, and the page itself stores the parent its
    // path hangs from.
    expect(String((await readDocument(payload, 'pages', tiles.id)).parent)).toBe(String(roof.id))
    expect(await readPathAndAncestors(payload, 'pages', moss.id)).toEqual({
      document: { ancestors: [roof.id, tiles.id], paths: paths('/roof/tiles/moss') },
      draft: { ancestors: [roof.id, tiles.id], paths: paths('/roof/tiles/moss') }
    })
    expect(changes).toEqual([])
    expect((await create(payload, 'pages', { slug: 'tiles', title: 'New tiles' })).path).toBe('/tiles')
  })

  it('keeps a published page where it is while a draft renames it, and moves it when the draft is published', async () => {
    const { changes, payload } = test
    const menu = await create(payload, 'pages', { slug: 'menu', title: 'Menu' })
    const lunch = await create(payload, 'pages', { parent: menu.id, slug: 'lunch', title: 'Lunch' })
    changes.length = 0

    await update(payload, 'pages', menu.id, { slug: 'food' }, { draft: true })

    expect(await readPathAndAncestors(payload, 'pages', menu.id)).toEqual({
      document: { ancestors: [], paths: paths('/menu') },
      draft: { ancestors: [], paths: paths('/food') }
    })
    expect(await readPathAndAncestors(payload, 'pages', lunch.id)).toEqual({
      document: { ancestors: [menu.id], paths: paths('/menu/lunch') },
      draft: { ancestors: [menu.id], paths: paths('/menu/lunch') }
    })
    expect(changes).toEqual([])
    expect(await catchFieldErrors(create(payload, 'pages', { slug: 'menu', title: 'New menu' }))).toMatchObject(
      takenBy('Page "Menu"')
    )

    await update(payload, 'pages', menu.id, {})

    expect((await readPathAndAncestors(payload, 'pages', menu.id)).document.paths).toEqual(paths('/food'))
    expect((await readPathAndAncestors(payload, 'pages', lunch.id)).document.paths).toEqual(paths('/food/lunch'))
    expect(changes).toEqual([
      [changed(setup, 'pages', menu, '/menu', '/food'), changed(setup, 'pages', lunch, '/menu/lunch', '/food/lunch')]
    ])
  })

  it('carries out a pending move when the page is unpublished, and when a version is restored', async () => {
    const { payload } = test
    const stage = await create(payload, 'pages', { slug: 'stage', title: 'Stage' })
    const lights = await create(payload, 'pages', { parent: stage.id, slug: 'lights', title: 'Lights' })
    const quay = await create(payload, 'pages', { slug: 'quay', title: 'Quay' })
    const boats = await create(payload, 'pages', { parent: quay.id, slug: 'boats', title: 'Boats' })
    await update(payload, 'pages', stage.id, { slug: 'platform' }, { draft: true })
    await update(payload, 'pages', quay.id, { slug: 'mooring' }, { draft: true })
    await update(payload, 'pages', quay.id, { slug: 'quay' }, { draft: true })

    // As the admin's Unpublish button saves: the status alone, without draft.
    await payload.update({ collection: 'pages', data: { _status: 'draft' }, id: stage.id, overrideAccess: true })
    // A restore without draft writes the version to the page itself, with the status the version has.
    await restoreVersion(payload, 'pages', quay.id, { version: 1 })

    expect((await readPathAndAncestors(payload, 'pages', lights.id)).document.paths).toEqual(paths('/platform/lights'))
    expect((await readPathAndAncestors(payload, 'pages', boats.id)).document.paths).toEqual(paths('/mooring/boats'))
  })

  it('moves a page at once when a draft renames it after it was unpublished', async () => {
    const { payload } = test
    const porch = await create(payload, 'pages', { slug: 'porch', title: 'Porch' })
    const steps = await create(payload, 'pages', { parent: porch.id, slug: 'steps', title: 'Steps' })
    await payload.update({ collection: 'pages', data: { _status: 'draft' }, id: porch.id, overrideAccess: true })

    await update(payload, 'pages', porch.id, { slug: 'veranda' }, { draft: true })

    expect((await readPathAndAncestors(payload, 'pages', porch.id)).document.paths).toEqual(paths('/veranda'))
    expect((await readPathAndAncestors(payload, 'pages', steps.id)).document.paths).toEqual(paths('/veranda/steps'))
  })

  it('works out the home page, a base of ancestors and a document without a slug by the same rule', async () => {
    const { payload } = test
    const home = await create(payload, 'pages', { slug: 'home', title: 'Home' })
    const top = await create(payload, 'posts', { slug: 'top', title: 'Top' })
    const middle = await create(payload, 'posts', { parent: top.id, slug: 'middle', title: 'Middle' })
    const leaf = await create(payload, 'posts', { parent: middle.id, slug: 'leaf', title: 'Leaf' })
    const empty = await create(payload, 'posts', {}, { draft: true })
    const none = setup.localized ? { en: null, sv: null } : { '': null }

    expect((await readPathAndAncestors(payload, 'pages', home.id)).document).toEqual({ ancestors: [], paths: paths('/') })
    expect((await readPathAndAncestors(payload, 'posts', leaf.id)).document).toEqual({
      ancestors: [top.id, middle.id],
      paths: paths('/top/middle/leaf')
    })
    expect(await readPathAndAncestors(payload, 'posts', empty.id)).toEqual({
      document: { ancestors: [], paths: none },
      draft: { ancestors: [], paths: none }
    })
  })

  // The rest is about locales. The same block, because Payload pushes a schema to a database only when
  // it is another one than the last it pushed, and a block of its own would follow one with the same.
  if (!setup.localized) return
  const inSwedish = { locale: 'sv' }

  const readPaths = async (id: Id) => {
    const { document, draft } = await readPathAndAncestors(test.payload, 'pages', id)
    return { document: document.paths, draft: draft.paths }
  }
  const both = (english: string, swedish: string) => {
    const paths = { en: english, sv: swedish }
    return { document: paths, draft: paths }
  }

  it('moves the Swedish path at once when a draft renames a page that is published in English only', async () => {
    const { changes, payload } = test
    const cellar = await create(payload, 'pages', { slug: 'cellar', title: 'Cellar' })
    const casks = await create(payload, 'pages', { parent: cellar.id, slug: 'casks', title: 'Casks' })
    changes.length = 0

    await update(payload, 'pages', cellar.id, { slug: 'kallare' }, { draft: true, locale: 'sv' })

    expect(await readPaths(cellar.id)).toEqual(both('/cellar', '/kallare'))
    expect(await readPaths(casks.id)).toEqual(both('/cellar/casks', '/kallare/casks'))
    // The page and the page below it are published in English only, so a Swedish path is no
    // published path, and the site hears nothing.
    expect(changes).toEqual([])
  })

  it('changes no Swedish path when a page with a Swedish draft slug is published in English again', async () => {
    const { changes, payload } = test
    const pantry = await create(payload, 'pages', { slug: 'pantry', title: 'Pantry' })
    const jars = await create(payload, 'pages', { parent: pantry.id, slug: 'jars', title: 'Jars' })
    await update(payload, 'pages', pantry.id, { slug: 'skafferi' }, { draft: true, locale: 'sv' })
    changes.length = 0

    // Payload writes the English publish to the page itself without what Swedish held there.
    await update(payload, 'pages', pantry.id, { title: 'The pantry' })

    expect(await readPaths(pantry.id)).toEqual(both('/pantry', '/skafferi'))
    expect(await readPaths(jars.id)).toEqual(both('/pantry/jars', '/skafferi/jars'))
    expect(changes).toEqual([[changed(setup, 'pages', pantry, '/pantry', '/pantry')]])
  })

  it('keeps a Swedish rename pending on a page published in both locales, until Swedish is published', async () => {
    const { changes, payload } = test
    const dairy = await create(payload, 'pages', { slug: 'dairy', title: 'Dairy' })
    await update(payload, 'pages', dairy.id, { slug: 'mejeri', title: 'Mejeri' }, inSwedish)
    const churn = await create(payload, 'pages', { parent: dairy.id, slug: 'churn', title: 'Churn' })
    const pending = { document: { en: '/dairy', sv: '/mejeri' }, draft: { en: '/dairy', sv: '/ysteri' } }

    await update(payload, 'pages', dairy.id, { slug: 'ysteri' }, { draft: true, locale: 'sv' })
    expect(await readPaths(dairy.id)).toEqual(pending)

    changes.length = 0
    await update(payload, 'pages', dairy.id, { title: 'The dairy' })
    expect(await readPaths(dairy.id)).toEqual(pending)
    expect(await readPaths(churn.id)).toEqual(both('/dairy/churn', '/mejeri/churn'))
    expect(changes).toEqual([[changed(setup, 'pages', dairy, '/dairy', '/dairy')]])

    await update(payload, 'pages', dairy.id, {}, inSwedish)
    expect(await readPaths(dairy.id)).toEqual(both('/dairy', '/ysteri'))
    expect(await readPaths(churn.id)).toEqual(both('/dairy/churn', '/ysteri/churn'))
  })

  it("keeps a draft's new parent pending on a page published in English only, until English is unpublished", async () => {
    const { payload } = test
    const east = await create(payload, 'pages', { slug: 'east-wing', title: 'East wing' })
    const west = await create(payload, 'pages', { slug: 'west-wing', title: 'West wing' })
    const hall = await create(payload, 'pages', { parent: east.id, slug: 'hall', title: 'Hall' })
    const seats = await create(payload, 'pages', { parent: hall.id, slug: 'seats', title: 'Seats' })

    await update(payload, 'pages', hall.id, { parent: west.id }, { draft: true, locale: 'sv' })

    // The parent is one for every locale, so it is pending in Swedish too.
    expect(await readPathAndAncestors(payload, 'pages', hall.id)).toEqual({
      document: { ancestors: [east.id], paths: { en: '/east-wing/hall', sv: '/east-wing/hall' } },
      draft: { ancestors: [west.id], paths: { en: '/west-wing/hall', sv: '/west-wing/hall' } }
    })
    expect(await readPaths(seats.id)).toEqual(both('/east-wing/hall/seats', '/east-wing/hall/seats'))

    await payload.update({ collection: 'pages', data: { _status: 'draft' }, id: hall.id, locale: 'en', overrideAccess: true })

    expect((await readPathAndAncestors(payload, 'pages', hall.id)).document).toEqual({
      ancestors: [west.id],
      paths: { en: '/west-wing/hall', sv: '/west-wing/hall' }
    })
    expect(await readPaths(seats.id)).toEqual(both('/west-wing/hall/seats', '/west-wing/hall/seats'))
  })

  // A collection without drafts has no latest version for a locale to fall back in, so a locale has a
  // path from the first save in it, which keeps the slug it falls back to as the locale's own.
  const readNoticePaths = async (id: Id) => {
    const stored = await test.payload.db.findOne<{ id: Id; path?: Record<string, null | string> }>({
      collection: 'notices',
      where: { id: { equals: id } }
    })
    return { en: stored?.path?.en ?? null, sv: stored?.path?.sv ?? null }
  }

  it('gives a document of a collection without drafts the slug it falls back to when it is first saved in a locale', async () => {
    const { payload } = test
    const visit = await create(payload, 'notices', { slug: 'visit', title: 'Visit' })
    const hours = await create(payload, 'notices', { parent: visit.id, slug: 'hours', title: 'Hours' })
    await update(payload, 'notices', visit.id, { slug: 'besok', title: 'Besök' }, inSwedish)

    const swedish = await update(payload, 'notices', hours.id, { title: 'Öppettider' }, inSwedish)

    expect(swedish).toMatchObject({ path: '/besok/hours', slug: 'hours' })
    expect(await readNoticePaths(hours.id)).toEqual({ en: '/visit/hours', sv: '/besok/hours' })
    expect(await findByPath({ locale: 'sv', path: '/besok/hours', payload })).toMatchObject({
      collection: 'notices',
      document: { id: hours.id }
    })
    expect((await update(payload, 'notices', hours.id, { title: 'Våra öppettider' }, inSwedish)).path).toBe('/besok/hours')
  })

  it('saves a document of a collection without drafts in a locale its parent has no path in, without a path there', async () => {
    const { payload } = test
    const tours = await create(payload, 'notices', { slug: 'tours', title: 'Tours' })
    const boat = await create(payload, 'notices', { parent: tours.id, slug: 'boat', title: 'Boat' })

    const swedish = await update(payload, 'notices', boat.id, { title: 'Båt' }, inSwedish)

    expect(swedish).toMatchObject({ parent: { id: tours.id }, slug: 'boat' })
    expect(await readNoticePaths(boat.id)).toEqual({ en: '/tours/boat', sv: null })
  })

  it('gives a locale of a collection without drafts no path before the document is saved in it, and a typed slug wins', async () => {
    const { payload } = test
    const tickets = await create(payload, 'notices', { slug: 'tickets', title: 'Tickets' })
    const prices = await create(payload, 'notices', { parent: tickets.id, slug: 'prices', title: 'Prices' })
    expect(await readNoticePaths(tickets.id)).toEqual({ en: '/tickets', sv: null })

    await update(payload, 'notices', tickets.id, { slug: 'biljetter', title: 'Biljetter' }, inSwedish)

    expect(await readNoticePaths(tickets.id)).toEqual({ en: '/tickets', sv: '/biljetter' })
    // The notice below was never saved in Swedish.
    expect(await readNoticePaths(prices.id)).toEqual({ en: '/tickets/prices', sv: null })
    expect(await findByPath({ locale: 'sv', path: '/biljetter/prices', payload })).toBeNull()
  })
})
