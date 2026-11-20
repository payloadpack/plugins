import type { CollectionSlug } from 'payload'
import { expect, it } from 'vitest'

import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled, type TestPayload } from './support/boot-payload.js'
import {
  catchFieldErrors,
  changed,
  countLatestVersions,
  create,
  readDocument,
  readLatestVersion,
  readPath,
  readRows,
  readVersionPaths,
  remove,
  restoreVersion,
  store,
  storeDraftAncestorsInRow,
  storeParentInRow,
  storePathInRow,
  update
} from './support/documents.js'
import { holdRow, readStoredParentAndAncestors, waitForRowWait } from './support/raw-access.js'
import { SETUPS } from './support/setups.js'

describeEachSetup('', {}, (test, setup) => {
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
    expect(await readPath(payload, 'pages', tickets.id, { draft: true })).toBe('/port/fares')
    // A restore takes its path from the parent and the slug, so older versions keep theirs.
    expect(await readVersionPaths(payload, 'pages', timetable.id)).toEqual([
      '/port/ferries/timetable',
      '/harbour/ferries/timetable'
    ])
    expect(await readVersionPaths(payload, 'pages', tickets.id)).toEqual(['/port/fares', '/harbour/tickets'])
  })

  // Creates each page below the one before it, the first below the parent given, and returns their ids.
  const createDown = async (slugs: string[], parent?: Id) => {
    const ids: Id[] = []
    for (const slug of slugs)
      ids.push((await create(test.payload, 'pages', { parent: ids.at(-1) ?? parent, slug, title: slug })).id)
    return ids
  }

  // A rename, a move or a delete of a page below the pages given, which returns the ancestors of the
  // pages right below it after.
  type Change = (page: Id, above: Id[]) => Promise<Id[]>
  const rename =
    (slug: string): Change =>
    async (page, above) => {
      await update(test.payload, 'pages', page, { slug })
      return [...above, page]
    }
  const moveBelow =
    (slugs: string[]): Change =>
    async (page) => {
      const newAboveIds = await createDown(slugs)
      await update(test.payload, 'pages', page, { parent: newAboveIds.at(-1) ?? null })
      return [...newAboveIds, page]
    }
  const deletePage: Change = async (page, above) => {
    await remove(test.payload, 'pages', page)
    return above
  }

  // A delete for good takes the deleted page out of the older versions itself on Postgres and SQLite,
  // where their relationships to it go with it, so for a delete the latest version is compared only.
  it.each([
    { name: 'a renamed page', above: [], change: rename('grove'), olderVersions: true, page: 'orchard', path: '/grove/pear' },
    {
      name: 'a page moved to another parent',
      above: [],
      change: moveBelow(['field']),
      olderVersions: true,
      page: 'copse',
      path: '/field/copse/pear'
    },
    { name: 'a deleted page', above: ['meadow'], change: deletePage, olderVersions: false, page: 'hedge', path: '/meadow/pear' }
  ])(
    'leaves every other value of a document below $name as it was, its updatedAt too, in the document and its versions',
    async ({ above, change, olderVersions, page: slug, path }) => {
      const { payload } = test
      const aboveIds = await createDown(above)
      const [page, pear] = await createDown([slug, 'pear'], aboveIds.at(-1))
      await update(payload, 'pages', pear!, { title: 'Pear tree' }, { draft: true })
      const readComparedRows = async () => {
        const { documents, versions } = await readRows(payload, 'pages', [pear!])
        return { documents, versions: versions.filter(({ latest }) => latest || olderVersions) }
      }
      const before = await readComparedRows()

      const ancestors = await change(page!, aboveIds)

      const newPathAndAncestors = { ancestors, parent: ancestors.at(-1), path: setup.localized ? { en: path, sv: path } : path }
      expect(await readComparedRows()).toEqual({
        documents: before.documents.map((document) => ({ ...document, ...newPathAndAncestors })),
        versions: before.versions.map((version) =>
          version.latest ? { ...version, version: { ...(version.version as object), ...newPathAndAncestors } } : version
        )
      })
    }
  )

  it.each([
    {
      name: 'renamed four levels down',
      above: ['office', 'floor', 'wing'],
      change: rename('crew'),
      slug: 'team',
      start: '/office/floor/wing/crew/team'
    },
    {
      name: 'moved four levels down to another parent',
      above: ['tower', 'level', 'corner'],
      change: moveBelow(['depot', 'hall', 'bay']),
      slug: 'unit',
      start: '/depot/hall/bay/unit/unit'
    },
    {
      name: 'moved from four levels down to the top level',
      above: ['school', 'grade', 'class'],
      change: moveBelow([]),
      slug: 'group',
      start: '/group/group'
    },
    {
      name: 'moved from the top level to four levels down',
      above: [],
      change: moveBelow(['city', 'venue', 'stage']),
      slug: 'band',
      start: '/city/venue/stage/band/band'
    },
    {
      name: 'deleted four levels down',
      above: ['museum', 'gallery', 'hall'],
      change: deletePage,
      slug: 'room',
      start: '/museum/gallery/hall/room'
    },
    { name: 'deleted at the top level', above: [], change: deletePage, slug: 'crowd', start: '/crowd' }
  ])(
    'changes only the start of each path below a page $name, also where its slug comes again further down',
    async ({ above, change, slug, start }) => {
      const { payload } = test
      const aboveIds = await createDown(above)
      const [page, squad, anna] = await createDown([slug, slug, 'anna'], aboveIds.at(-1))

      const ancestors = await change(page!, aboveIds)

      for (const draft of [false, true]) {
        expect(await readPath(payload, 'pages', squad!, { draft })).toBe(start)
        expect(await readDocument(payload, 'pages', anna!, { draft })).toMatchObject({
          ancestors: [...ancestors, squad],
          path: `${start}/anna`
        })
      }
    }
  )

  // An id an update pipeline writes as text where the database holds an ObjectId reads back the same
  // through Payload, and a move that finds the documents below by it finds none of them.
  it('stores the parent and ancestors below a moved and a deleted page as Payload stores them, so a later move finds the documents below', async () => {
    const { payload } = test
    const east = await create(payload, 'pages', { slug: 'east', title: 'East' })
    const west = await create(payload, 'pages', { slug: 'west', title: 'West' })
    const [rack, shelf, bin] = await createDown(['rack', 'shelf', 'bin'])
    // At the top level Payload's page is moved there, which stores a parent of null, where on MongoDB a
    // page created there stores none.
    const readParentAndAncestorsBesidePayloadPage = async (id: Id, slug: string, parent?: Id) => {
      const [payloadPage] = await createDown([slug], parent ?? west.id)
      if (parent === undefined) await update(payload, 'pages', payloadPage!, { parent: null })
      return {
        page: await readStoredParentAndAncestors(test, setup, 'pages', id),
        payloadPage: await readStoredParentAndAncestors(test, setup, 'pages', payloadPage!)
      }
    }

    await update(payload, 'pages', rack!, { parent: east.id })
    const parentAndAncestorsAfterMove = await readParentAndAncestorsBesidePayloadPage(bin!, 'crate', shelf!)
    await remove(payload, 'pages', rack!)
    const parentAndAncestorsAfterLift = await readParentAndAncestorsBesidePayloadPage(shelf!, 'drawer', east.id)
    await remove(payload, 'pages', east.id)
    const parentAndAncestorsAfterLiftToTopLevel = await readParentAndAncestorsBesidePayloadPage(shelf!, 'tray')
    await update(payload, 'pages', shelf!, { parent: west.id })

    expect(parentAndAncestorsAfterMove.page).toEqual(parentAndAncestorsAfterMove.payloadPage)
    expect(parentAndAncestorsAfterLift.page).toEqual(parentAndAncestorsAfterLift.payloadPage)
    expect(parentAndAncestorsAfterLift.page).toMatchObject({
      document: { ancestors: { length: 1 } },
      version: { ancestors: { length: 1 } }
    })
    expect(parentAndAncestorsAfterLiftToTopLevel.page).toEqual(parentAndAncestorsAfterLiftToTopLevel.payloadPage)
    for (const draft of [false, true]) {
      expect(await readDocument(payload, 'pages', bin!, { draft })).toMatchObject({
        ancestors: [west.id, shelf],
        path: '/west/shelf/bin'
      })
    }
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
    // version holds, so there the page keeps the parent it has.
    const keepsParent = setup.database === 'mongodb'

    await restoreVersion(payload, 'pages', shed.id)

    expect(await readDocument(payload, 'pages', shed.id)).toMatchObject(
      keepsParent
        ? { ancestors: [annex.id], parent: annex.id, path: '/annex/shed' }
        : { ancestors: [], parent: null, path: '/shed' }
    )
    expect(await readPath(payload, 'pages', tools.id)).toBe(keepsParent ? '/annex/shed/tools' : '/shed/tools')
  })

  it('keeps the parent in agreement with the path and ancestors when a version from before a page had a parent is restored as a draft and then published', async () => {
    const { payload } = test
    const lodge = await create(payload, 'pages', { slug: 'lodge', title: 'Lodge' })
    const hut = await create(payload, 'pages', { slug: 'hut', title: 'Hut' })
    await update(payload, 'pages', hut.id, { parent: lodge.id })
    // On MongoDB the page keeps the parent it has, as in a restore without draft.
    const expected =
      setup.database === 'mongodb'
        ? { ancestors: [lodge.id], parent: lodge.id, path: '/lodge/hut' }
        : { ancestors: [], parent: null, path: '/hut' }
    const readLatest = async () => {
      const { ancestors, parent = null } = await readLatestVersion(payload, 'pages', hut.id)
      return { ancestors, parent, path: await readPath(payload, 'pages', hut.id, { draft: true }) }
    }

    await restoreVersion(payload, 'pages', hut.id, { draft: true })

    expect(await readLatest()).toEqual(expected)
    expect(await readDocument(payload, 'pages', hut.id)).toMatchObject({
      ancestors: [lodge.id],
      parent: lodge.id,
      path: '/lodge/hut'
    })

    await update(payload, 'pages', hut.id, {})

    expect(await readLatest()).toEqual(expected)
    expect(await readDocument(payload, 'pages', hut.id)).toMatchObject(expected)
  })

  it.each([
    { name: 'renamed', above: [], change: rename('mall'), page: 'arcade', path: '/mall' },
    { name: 'moved to another parent', above: [], change: moveBelow(['square']), page: 'bazaar', path: '/square/bazaar' },
    { name: 'deleted', above: ['market'], change: deletePage, page: 'souk', path: '/market' }
  ])(
    'gives a document below a page $name the path its own slug makes and the parent its ancestors end with, whatever it stored',
    async ({ above, change, page: slug, path }) => {
      const { payload } = test
      const aboveIds = await createDown(above)
      const [page] = await createDown([slug], aboveIds.at(-1))
      const lane = await create(payload, 'pages', { slug: `${slug}-lane`, title: 'Lane' })
      const kiosk = await create(payload, 'pages', { parent: page, slug: 'kiosk', title: 'Kiosk' })
      const stall = await create(payload, 'pages', { parent: page, slug: 'stall', title: 'Stall' })
      const booth = await create(payload, 'pages', { parent: page, slug: 'booth', title: 'Booth' })
      const cart = await create(payload, 'pages', { parent: page, slug: 'cart', title: 'Cart' }, { draft: true })
      const awning = await create(payload, 'pages', { parent: kiosk.id, slug: 'awning', title: 'Awning' })
      // The cart is never published, so it takes its parent from its latest version.
      const pagePath = ['', ...above, slug].join('/')
      await storePathInRow(payload, setup, 'pages', stall.id, `${pagePath}-annex/stall`)
      await storePathInRow(payload, setup, 'pages', booth.id, `${pagePath}/stand`)
      await storeParentInRow(payload, 'pages', cart.id, lane.id)
      await storeDraftAncestorsInRow(payload, 'pages', awning.id, [...aboveIds, kiosk.id])

      const ancestors = await change(page!, aboveIds)

      for (const [documentSlug, document] of Object.entries({ kiosk, stall, booth, cart })) {
        expect(await readDocument(payload, 'pages', document.id)).toMatchObject({
          ancestors,
          parent: ancestors.at(-1),
          path: `${path}/${documentSlug}`
        })
      }
      expect(await readDocument(payload, 'pages', awning.id, { draft: true })).toMatchObject({
        ancestors: [...ancestors, kiosk.id],
        path: `${path}/kiosk/awning`
      })
    }
  )

  it('leaves a document as it is that holds a renamed page among its ancestors and a parent outside its branch', async () => {
    const { changes, payload } = test
    const silo = await create(payload, 'pages', { slug: 'silo', title: 'Silo' })
    const yard = await create(payload, 'pages', { slug: 'yard', title: 'Yard' })
    const crate = await create(payload, 'pages', { parent: silo.id, slug: 'crate', title: 'Crate' })
    // A row out of step, as an import may leave it, which the rule builds nothing for.
    await storeParentInRow(payload, 'pages', crate.id, yard.id)
    changes.length = 0

    await update(payload, 'pages', silo.id, { slug: 'hangar' })

    expect(await readDocument(payload, 'pages', crate.id)).toMatchObject({
      ancestors: [silo.id],
      parent: yard.id,
      path: '/silo/crate'
    })
    expect(changes.flat()).toEqual([changed(setup, 'pages', silo, '/silo', '/hangar')])
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

// The move's statements write the path, the ancestors and the parent alone, so every other value a
// save wrote meanwhile is kept. With transactions such a save lands only after the move's transaction.
// Holding a row so that a write waits for it is Postgres's, so the other databases are left out:
// SQLite has one writer at a time.
describeEachSetup(
  'a move that waits to write a row of its branch, transactions off',
  { boot: { transactions: false }, setups: SETUPS.filter(({ database }) => database === 'postgres') },
  (test, setup) => {
    // A document as a site had it before it added the plugin, without a path.
    const storeBelow = (ancestors: Id[], slug: string, title: string) =>
      store(test, setup, 'pages', { ancestors, parent: ancestors.at(-1), slug, title })

    it('keeps a change committed to a document below a renamed page while the move waits to write its row, and gives it its new path', async () => {
      const { payload } = test
      const tray = await create(payload, 'pages', { slug: 'tray', title: 'Tray' })
      const cup = await create(payload, 'pages', { parent: tray.id, slug: 'cup', title: 'Cup' })
      const commit = await holdRow(payload, setup, 'pages', cup.id, { savedTitle: 'Teacup' })

      const rename = update(payload, 'pages', tray.id, { slug: 'platter' })
      const renameWaited = await waitForRowWait(payload)
      await commit()
      await rename

      const { path, title } = await readDocument(payload, 'pages', cup.id)
      expect({ path, renameWaited, title }).toEqual({ path: '/platter/cup', renameWaited: true, title: 'Teacup' })
    })

    it.each([
      { name: 'renamed', change: 'rename', slug: 'board' },
      { name: 'moved to another parent', change: 'move', slug: 'dresser' },
      { name: 'deleted', change: 'delete', slug: 'sideboard' }
    ] as const)(
      'keeps a change committed to a document stored without a path below a page $name while the move waits for its row',
      async ({ change, slug }) => {
        const { payload } = test
        const room = await create(payload, 'pages', { slug: `${slug}-room`, title: 'Room' })
        const hall = await create(payload, 'pages', { slug: `${slug}-hall`, title: 'Hall' })
        const page = await create(payload, 'pages', { parent: room.id, slug, title: 'Page' })
        const mug = await storeBelow([room.id, page.id], 'mug', 'Mug')
        const commit = await holdRow(payload, setup, 'pages', mug, { savedTitle: 'Tankard' })

        const move =
          change === 'rename'
            ? update(payload, 'pages', page.id, { slug: `${slug}-counter` })
            : change === 'move'
              ? update(payload, 'pages', page.id, { parent: hall.id })
              : remove(payload, 'pages', page.id)
        const moveWaited = await waitForRowWait(payload)
        await commit()
        await move

        const { ancestors, parent, path, title } = await readDocument(payload, 'pages', mug)
        expect({ ancestors, moveWaited, parent, path, title }).toEqual({
          ...{
            delete: { ancestors: [room.id], parent: room.id, path: `/${slug}-room/mug` },
            move: { ancestors: [hall.id, page.id], parent: page.id, path: `/${slug}-hall/${slug}/mug` },
            rename: { ancestors: [room.id, page.id], parent: page.id, path: `/${slug}-room/${slug}-counter/mug` }
          }[change],
          moveWaited: true,
          title: 'Tankard'
        })
      }
    )

    it('keeps the title documents below a renamed page are saved with while the move is under way, published or as a draft, each with one latest version', async () => {
      const { payload } = test
      const shelf = await create(payload, 'pages', { slug: 'shelf', title: 'Shelf' })
      const first = await storeBelow([shelf.id], 'first-book', 'First book')
      const second = await storeBelow([shelf.id], 'second-book', 'Second book')
      const third = await storeBelow([shelf.id], 'third-book', 'Third book')
      const letGo = await holdRow(payload, setup, 'pages', first)

      const rename = update(payload, 'pages', shelf.id, { slug: 'bookcase' })
      const renameWaited = await waitForRowWait(payload)
      await update(payload, 'pages', second, { title: 'Second edition' })
      await update(payload, 'pages', third, { title: 'Third edition' }, { draft: true })
      await letGo()
      await rename

      const readSavedDocument = async (id: Id, draft: boolean) => {
        const { path, title } = await readDocument(payload, 'pages', id, { draft })
        return { latest: await countLatestVersions(payload, 'pages', id), path, title }
      }
      expect({
        draft: await readSavedDocument(third, true),
        published: await readSavedDocument(second, false),
        renameWaited
      }).toEqual({
        draft: { latest: 1, path: '/bookcase/third-book', title: 'Third edition' },
        published: { latest: 1, path: '/bookcase/second-book', title: 'Second edition' },
        renameWaited: true
      })
    })
  }
)

type IdKind = { name: string; collection: CollectionSlug; idOf?: (slug: string) => number | string }

// The statements write the ids above a row into its ancestors, and on Postgres with transactions the
// lock names the moved document's id, so each reaches the database in the collection's type of id.
// Payload's default ids are tried above: a number the database counts up, and an ObjectId on MongoDB.
const itMovesABranchWithIdsOf = (test: TestPayload, kinds: IdKind[]) =>
  it.each(kinds)(
    'renames, moves and lifts a branch with $name, and gives every document its path, ancestors and parent',
    async ({ collection, idOf }) => {
      const { payload } = test
      const make = async (slug: string, parent?: Id) =>
        (await create(payload, collection, { ...(idOf ? { id: idOf(slug) } : {}), parent, slug, title: slug })).id
      const dock = await make(`${collection}-dock`)
      const pier = await make(`${collection}-pier`)
      const shed = await make('shed', dock)
      const crate = await make('crate', shed)
      const rope = await make('rope', dock)
      const expectRows = async (rows: [Id, Id[], string][]) => {
        for (const [id, ancestors, path] of rows) {
          for (const draft of [false, true]) {
            const document = await readDocument(payload, collection, id, { draft })
            expect({ ancestors: document.ancestors, parent: document.parent ?? null, path: document.path }).toEqual({
              ancestors,
              parent: ancestors.at(-1) ?? null,
              path
            })
          }
        }
      }

      await update(payload, collection, dock, { slug: `${collection}-harbour` })

      await expectRows([
        [shed, [dock], `/${collection}-harbour/shed`],
        [crate, [dock, shed], `/${collection}-harbour/shed/crate`],
        [rope, [dock], `/${collection}-harbour/rope`]
      ])

      await update(payload, collection, shed, { parent: pier })

      await expectRows([
        [shed, [pier], `/${collection}-pier/shed`],
        [crate, [pier, shed], `/${collection}-pier/shed/crate`],
        [rope, [dock], `/${collection}-harbour/rope`]
      ])

      await remove(payload, collection, shed)

      await expectRows([
        [crate, [pier], `/${collection}-pier/crate`],
        [rope, [dock], `/${collection}-harbour/rope`]
      ])
    }
  )

describeEachSetup(
  'a collection with uuid ids',
  { boot: { idType: 'uuid' }, setups: SETUPS.filter(({ database }) => database !== 'mongodb') },
  (test) => itMovesABranchWithIdsOf(test, [{ name: 'uuid ids', collection: 'pages' }])
)

let ticketNumber = 0

// The statements find the tables of a collection and of its versions by its slug, which the database
// knows them by in another form where the slug has capitals or more than one word, and by another
// name where the collection has a dbName.
describeEachSetup(
  'collections whose tables are not named as their slugs, and collections with ids of their own',
  {
    boot: (setup) => ({
      collections: [
        { ...titled('field-notes', setup.localized), dbName: 'journal' },
        titled('FAQ-items', setup.localized),
        titled('tickets', setup.localized, [{ name: 'id', type: 'number' }]),
        titled('tags', setup.localized, [{ name: 'id', type: 'text' }])
      ],
      options: { collections: ['pages', 'posts', 'notices', 'field-notes', 'FAQ-items', 'tickets', 'tags'] }
    })
  },
  (test) => {
    it.each([
      { name: 'a slug of two words and a name of its own in the database', collection: 'field-notes', slug: 'birds' },
      { name: 'a slug with capitals', collection: 'FAQ-items', slug: 'billing' }
    ] as const)(
      'gives the documents below a renamed and moved document of a collection with $name their paths and ancestors, drafts too',
      async ({ collection, slug }) => {
        const { payload } = test
        const top = await create(payload, collection, { slug, title: 'Top' })
        const other = await create(payload, collection, { slug: `${slug}-other`, title: 'Other' })
        const middle = await create(payload, collection, { parent: top.id, slug: 'middle', title: 'Middle' })
        const low = await create(payload, collection, { parent: middle.id, slug: 'low', title: 'Low' })

        await update(payload, collection, top.id, { slug: `${slug}-renamed` })
        await update(payload, collection, top.id, { parent: other.id })

        for (const draft of [false, true]) {
          expect(await readDocument(payload, collection, middle.id, { draft })).toMatchObject({
            ancestors: [other.id, top.id],
            path: `/${slug}-other/${slug}-renamed/middle`
          })
          expect(await readDocument(payload, collection, low.id, { draft })).toMatchObject({
            ancestors: [other.id, top.id, middle.id],
            path: `/${slug}-other/${slug}-renamed/middle/low`
          })
        }
      }
    )

    itMovesABranchWithIdsOf(test, [
      { name: 'number ids of its own', collection: 'tickets', idOf: () => ++ticketNumber },
      { name: 'text ids of its own', collection: 'tags', idOf: (slug) => `tag-${slug}` }
    ])
  }
)

// A collection with timestamps: false stores no updatedAt for a move to leave as it is. Payload
// requires timestamps for versions, which it keeps by default.
describeEachSetup(
  'a collection without timestamps',
  {
    boot: (setup) => ({
      collections: [
        {
          slug: 'logbooks',
          admin: { useAsTitle: 'title' },
          fields: [{ name: 'title', type: 'text', localized: setup.localized }],
          timestamps: false,
          versions: false
        }
      ],
      options: { collections: ['pages', 'posts', 'notices', 'logbooks'] }
    })
  },
  (test, setup) => {
    it('gives every document below a renamed document its new path', async () => {
      const { payload } = test
      const voyages = await create(payload, 'logbooks', { slug: 'voyages', title: 'Voyages' })
      const atlantic = await create(payload, 'logbooks', { parent: voyages.id, slug: 'atlantic', title: 'Atlantic' })
      const azores = await create(payload, 'logbooks', { parent: atlantic.id, slug: 'azores', title: 'Azores' })

      await update(payload, 'logbooks', voyages.id, { slug: 'crossings' })

      expect(await readPath(payload, 'logbooks', atlantic.id)).toBe('/crossings/atlantic')
      expect(await readDocument(payload, 'logbooks', azores.id)).toMatchObject({
        ancestors: [voyages.id, atlantic.id],
        path: '/crossings/atlantic/azores'
      })
    })
  }
)
