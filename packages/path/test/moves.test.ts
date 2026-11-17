import { expect, it } from 'vitest'

import { describeEachSetup } from './support/boot-payload.js'
import {
  catchFieldErrors,
  create,
  readDocument,
  readLatestVersion,
  readPath,
  readVersionPaths,
  remove,
  restoreVersion,
  update
} from './support/documents.js'

describeEachSetup('', { boot: { options: { maxDocumentsPerMove: 3 } } }, (test, setup) => {
  it('gives every document below a renamed page its new path, in its latest version too', async () => {
    const { payload } = test
    const harbour = await create(payload, 'pages', { slug: 'harbour', title: 'Harbour' })
    const ferries = await create(payload, 'pages', { parent: harbour.id, slug: 'ferries', title: 'Ferries' })
    const timetable = await create(payload, 'pages', { parent: ferries.id, slug: 'timetable', title: 'Timetable' })
    const tickets = await create(payload, 'pages', { parent: harbour.id, slug: 'tickets', title: 'Tickets' })
    await update(payload, 'pages', tickets.id, { slug: 'fares' }, { draft: true })
    await update(payload, 'pages', timetable.id, { title: 'Summer timetable' }, { draft: true })

    await update(payload, 'pages', harbour.id, { slug: 'port' })

    expect(await readPath(payload, 'pages', ferries.id)).toBe('/port/ferries')
    expect(await readPath(payload, 'pages', timetable.id)).toBe('/port/ferries/timetable')
    expect(await readPath(payload, 'pages', tickets.id)).toBe('/port/tickets')
    // A draft keeps the slug it plans, under the page's new path.
    expect(await readPath(payload, 'pages', tickets.id, { draft: true })).toBe('/port/fares')
    // A restore takes its path from the parent and the slug, so older versions keep theirs.
    expect(await readVersionPaths(payload, 'pages', timetable.id)).toEqual([
      '/port/ferries/timetable',
      '/harbour/ferries/timetable'
    ])
    expect(await readVersionPaths(payload, 'pages', tickets.id)).toEqual(['/port/fares', '/harbour/tickets'])
  })

  it('moves a page and everything below it to a new parent', async () => {
    const { payload } = test
    const coast = await create(payload, 'pages', { slug: 'coast', title: 'Coast' })
    const bay = await create(payload, 'pages', { slug: 'bay', title: 'Bay' })
    const cove = await create(payload, 'pages', { parent: bay.id, slug: 'cove', title: 'Cove' })
    const pebbles = await create(payload, 'pages', { parent: cove.id, slug: 'pebbles', title: 'Pebbles' })

    await update(payload, 'pages', bay.id, { parent: coast.id })

    expect(await readPath(payload, 'pages', pebbles.id)).toBe('/coast/bay/cove/pebbles')
    expect((await readDocument(payload, 'pages', pebbles.id)).ancestors).toEqual([coast.id, bay.id, cove.id])
  })

  it('moves a page and everything below it to the top level', async () => {
    const { payload } = test
    const cliff = await create(payload, 'pages', { slug: 'cliff', title: 'Cliff' })
    const ledge = await create(payload, 'pages', { parent: cliff.id, slug: 'ledge', title: 'Ledge' })
    const nest = await create(payload, 'pages', { parent: ledge.id, slug: 'nest', title: 'Nest' })

    await update(payload, 'pages', ledge.id, { parent: null })

    expect(await readPath(payload, 'pages', nest.id)).toBe('/ledge/nest')
    expect((await readDocument(payload, 'pages', nest.id)).ancestors).toEqual([ledge.id])
    expect(await readVersionPaths(payload, 'pages', nest.id, { latest: { equals: true } })).toEqual(['/ledge/nest'])
  })

  it('moves a post and everything below it within the posts', async () => {
    const { payload } = test
    const trips = await create(payload, 'posts', { slug: 'trips', title: 'Trips' })
    const alps = await create(payload, 'posts', { slug: 'alps', title: 'Alps' })
    const day = await create(payload, 'posts', { parent: alps.id, slug: 'day-one', title: 'Day one' })
    const map = await create(payload, 'posts', { parent: day.id, slug: 'map', title: 'Map' })

    await update(payload, 'posts', alps.id, { parent: trips.id, slug: 'the-alps' })

    expect(await readPath(payload, 'posts', day.id)).toBe('/trips/the-alps/day-one')
    expect(await readPath(payload, 'posts', map.id)).toBe('/trips/the-alps/day-one/map')
    expect((await readDocument(payload, 'posts', map.id)).ancestors).toEqual([trips.id, alps.id, day.id])
    expect(await readVersionPaths(payload, 'posts', map.id, { latest: { equals: true } })).toEqual([
      '/trips/the-alps/day-one/map'
    ])
  })

  it('moves the documents below a document of a collection without drafts when a save renames it', async () => {
    const { payload } = test
    const bulletin = await create(payload, 'notices', { slug: 'bulletin', title: 'Bulletin' })
    const rota = await create(payload, 'notices', { parent: bulletin.id, slug: 'rota', title: 'Rota' })

    await update(payload, 'notices', bulletin.id, { slug: 'board' })

    expect(await readPath(payload, 'notices', rota.id)).toBe('/board/rota')
  })

  it('moves a document of a collection without drafts and everything below it to a new parent', async () => {
    const { payload } = test
    const lobby = await create(payload, 'notices', { slug: 'lobby', title: 'Lobby' })
    const hall = await create(payload, 'notices', { slug: 'hall', title: 'Hall' })
    const flyer = await create(payload, 'notices', { parent: hall.id, slug: 'flyer', title: 'Flyer' })

    await update(payload, 'notices', hall.id, { parent: lobby.id })

    expect(await readPath(payload, 'notices', flyer.id)).toBe('/lobby/hall/flyer')
    expect((await readDocument(payload, 'notices', flyer.id)).ancestors).toEqual([lobby.id, hall.id])
  })

  it('refuses a move that carries more documents than maxDocumentsPerMove, and moves none', async () => {
    const { payload } = test
    const ledger = await create(payload, 'pages', { slug: 'ledger', title: 'Ledger' })
    const entries = []
    for (const index of [1, 2, 3, 4]) {
      entries.push(await create(payload, 'pages', { parent: ledger.id, slug: `entry-${index}`, title: `Entry ${index}` }))
    }

    expect(await catchFieldErrors(update(payload, 'pages', ledger.id, { slug: 'tally' }))).toMatchObject([
      {
        message:
          'Page "Ledger" has 4 pages below it, and a move carries at most 3, so move some of them under another page first.',
        path: 'slug'
      }
    ])
    expect(await readPath(payload, 'pages', ledger.id)).toBe('/ledger')
    expect(await readPath(payload, 'pages', entries[0]!.id)).toBe('/ledger/entry-1')
  })

  it('refuses a delete that lifts more documents than maxDocumentsPerMove, and lifts none', async () => {
    const { payload } = test
    const accounts = await create(payload, 'pages', { slug: 'accounts', title: 'Accounts' })
    const entries = []
    for (const index of [1, 2, 3, 4]) {
      entries.push(await create(payload, 'pages', { parent: accounts.id, slug: `entry-${index}`, title: `Entry ${index}` }))
    }

    expect(await catchFieldErrors(remove(payload, 'pages', accounts.id))).toMatchObject([
      {
        message:
          'Page "Accounts" has 4 pages below it, and a move carries at most 3, so move some of them under another page first.',
        path: 'slug'
      }
    ])
    expect(await readPath(payload, 'pages', accounts.id)).toBe('/accounts')
    expect(await readPath(payload, 'pages', entries[0]!.id)).toBe('/accounts/entry-1')
  })

  it('moves a branch that carries as many documents as maxDocumentsPerMove', async () => {
    const { payload } = test
    const register = await create(payload, 'pages', { slug: 'register', title: 'Register' })
    const entries = []
    for (const index of [1, 2, 3]) {
      entries.push(await create(payload, 'pages', { parent: register.id, slug: `entry-${index}`, title: `Entry ${index}` }))
    }

    await update(payload, 'pages', register.id, { slug: 'roll' })

    expect(await readPath(payload, 'pages', entries[2]!.id)).toBe('/roll/entry-3')
  })

  it('gives a restored version with another slug the path of that slug, and moves the documents below it', async () => {
    const { payload } = test
    const pier = await create(payload, 'pages', { slug: 'pier', title: 'Pier' })
    const cafe = await create(payload, 'pages', { parent: pier.id, slug: 'cafe', title: 'Cafe' })
    await update(payload, 'pages', pier.id, { slug: 'jetty' })

    await restoreVersion(payload, 'pages', pier.id)

    expect(await readPath(payload, 'pages', pier.id)).toBe('/pier')
    expect(await readPath(payload, 'pages', cafe.id)).toBe('/pier/cafe')
  })

  it('gives a restored version with another parent the path below that parent, and moves the documents below it', async () => {
    const { payload } = test
    const north = await create(payload, 'pages', { slug: 'north-quay', title: 'North quay' })
    const south = await create(payload, 'pages', { slug: 'south-quay', title: 'South quay' })
    const crane = await create(payload, 'pages', { parent: north.id, slug: 'crane', title: 'Crane' })
    const hook = await create(payload, 'pages', { parent: crane.id, slug: 'hook', title: 'Hook' })
    await update(payload, 'pages', crane.id, { parent: south.id })

    await restoreVersion(payload, 'pages', crane.id)

    expect(await readPath(payload, 'pages', crane.id)).toBe('/north-quay/crane')
    expect((await readDocument(payload, 'pages', crane.id)).ancestors).toEqual([north.id])
    expect(await readPath(payload, 'pages', hook.id)).toBe('/north-quay/crane/hook')
  })

  it('gives a restored version the path below where its parent is now', async () => {
    const { payload } = test
    const fleet = await create(payload, 'pages', { slug: 'fleet', title: 'Fleet' })
    const tug = await create(payload, 'pages', { parent: fleet.id, slug: 'tug', title: 'Tug' })
    await update(payload, 'pages', tug.id, { title: 'Tugboat' })
    await update(payload, 'pages', fleet.id, { slug: 'ships' })

    await restoreVersion(payload, 'pages', tug.id)

    expect(await readDocument(payload, 'pages', tug.id)).toMatchObject({ path: '/ships/tug', title: 'Tug' })
  })

  it('restores a version from before a page had a parent to the top level, except on MongoDB, where Payload keeps the parent', async () => {
    const { payload } = test
    const annex = await create(payload, 'pages', { slug: 'annex', title: 'Annex' })
    const shed = await create(payload, 'pages', { slug: 'shed', title: 'Shed' })
    const tools = await create(payload, 'pages', { parent: shed.id, slug: 'tools', title: 'Tools' })
    await update(payload, 'pages', shed.id, { parent: annex.id })
    // MongoDB stores no parent for a top-level page, and Payload's restore writes only what the
    // version holds, so there the page keeps the parent it has, and the plugin places it below it.
    const keepsParent = setup.database === 'mongodb'

    await restoreVersion(payload, 'pages', shed.id)

    expect(await readDocument(payload, 'pages', shed.id)).toMatchObject(
      keepsParent
        ? { ancestors: [annex.id], parent: annex.id, path: '/annex/shed' }
        : { ancestors: [], parent: null, path: '/shed' }
    )
    expect(await readPath(payload, 'pages', tools.id)).toBe(keepsParent ? '/annex/shed/tools' : '/shed/tools')
  })

  it('keeps the parent and the place in agreement when a version from before a page had a parent is restored as a draft and then published', async () => {
    const { payload } = test
    const lodge = await create(payload, 'pages', { slug: 'lodge', title: 'Lodge' })
    const hut = await create(payload, 'pages', { slug: 'hut', title: 'Hut' })
    await update(payload, 'pages', hut.id, { parent: lodge.id })
    // On MongoDB the page keeps the parent it has, as in a restore without draft.
    const place =
      setup.database === 'mongodb'
        ? { ancestors: [lodge.id], parent: lodge.id, path: '/lodge/hut' }
        : { ancestors: [], parent: null, path: '/hut' }
    const readLatestPlace = async () => {
      const { ancestors, parent = null } = await readLatestVersion(payload, 'pages', hut.id)
      return { ancestors, parent, path: await readPath(payload, 'pages', hut.id, { draft: true }) }
    }

    await restoreVersion(payload, 'pages', hut.id, { draft: true })

    expect(await readLatestPlace()).toEqual(place)
    expect(await readDocument(payload, 'pages', hut.id)).toMatchObject({
      ancestors: [lodge.id],
      parent: lodge.id,
      path: '/lodge/hut'
    })

    await update(payload, 'pages', hut.id, {})

    expect(await readLatestPlace()).toEqual(place)
    expect(await readDocument(payload, 'pages', hut.id)).toMatchObject(place)
  })

  it('gives a document below a renamed page the path its own slug makes, whatever path it stored', async () => {
    const { payload } = test
    const arcade = await create(payload, 'pages', { slug: 'arcade', title: 'Arcade' })
    const kiosk = await create(payload, 'pages', { parent: arcade.id, slug: 'kiosk', title: 'Kiosk' })
    const stall = await create(payload, 'pages', { parent: arcade.id, slug: 'stall', title: 'Stall' })
    // Stored at a path that nothing the plugin writes leaves behind. A move makes each path again
    // from the slug and the parent, so it never rewrites what a path starts with.
    const strayPath = '/arcade-annex/stall'
    const stored = await payload.db.findOne({ collection: 'pages', where: { id: { equals: stall.id } } })
    await payload.db.updateOne({
      collection: 'pages',
      data: { ...stored, path: setup.localized ? { en: strayPath, sv: strayPath } : strayPath },
      id: stall.id
    })

    await update(payload, 'pages', arcade.id, { slug: 'mall' })

    expect(await readPath(payload, 'pages', kiosk.id)).toBe('/mall/kiosk')
    expect(await readPath(payload, 'pages', stall.id)).toBe('/mall/stall')
  })

  it('moves nothing published when a version is restored as a draft', async () => {
    const { changes, payload } = test
    const mill = await create(payload, 'pages', { slug: 'mill', title: 'Mill' })
    const flour = await create(payload, 'pages', { parent: mill.id, slug: 'flour', title: 'Flour' })
    await update(payload, 'pages', mill.id, { slug: 'windmill' })
    changes.length = 0

    await restoreVersion(payload, 'pages', mill.id, { draft: true })

    expect(await readPath(payload, 'pages', mill.id)).toBe('/windmill')
    expect(await readPath(payload, 'pages', mill.id, { draft: true })).toBe('/mill')
    expect(await readPath(payload, 'pages', flour.id)).toBe('/windmill/flour')
    expect(changes).toEqual([])
  })

  it('refuses to restore a version at a path another document was published at since, and moves nothing', async () => {
    const { payload } = test
    const wharf = await create(payload, 'pages', { slug: 'wharf', title: 'Wharf' })
    const nets = await create(payload, 'pages', { parent: wharf.id, slug: 'nets', title: 'Nets' })
    await update(payload, 'pages', wharf.id, { slug: 'landing' })
    await create(payload, 'posts', { slug: 'wharf', title: 'Wharf post' })

    expect(await catchFieldErrors(restoreVersion(payload, 'pages', wharf.id))).toMatchObject([
      { message: 'Post "Wharf post" is already at this path, so change the slug or the parent.', path: 'slug' }
    ])
    expect(await readPath(payload, 'pages', wharf.id)).toBe('/landing')
    expect(await readPath(payload, 'pages', nets.id)).toBe('/landing/nets')
  })
})
