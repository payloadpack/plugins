import { expect, it } from 'vitest'

import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup } from './support/boot-payload.js'
import {
  catchFieldErrors,
  countLatestVersions,
  create,
  readDocument,
  readLatestVersion,
  readPath,
  readVersionPaths,
  restoreVersion,
  update
} from './support/documents.js'
import { holdRow, setTimestampsThatAreNoDates, setUpdatedAtNotWrittenByPayload, waitForRowWait } from './support/raw-access.js'
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
    // A draft keeps its own slug, under the page's new path.
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
    // version holds, so there the page keeps the parent it has, and the plugin gives it the path below it.
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

// A move reads each row of its branch again right before it writes it, and writes it only while it is
// as it was read, so a save of a document below that lands while the move is under way is kept. Step
// by step on Postgres without transactions: a statement of the test holds the row of a document below
// a page, so the page's rename reads its branch and then waits to write that row. Meanwhile a document
// further along the branch is saved, or the held row itself is changed before it is let go. With
// transactions such a save lands only after the move's transaction. Holding a row so that a write
// waits for it is Postgres's, so the other databases are left out: SQLite has one writer at a time.
describeEachSetup(
  'a move that waits to write a row of its branch, transactions off',
  { boot: { transactions: false }, setups: SETUPS.filter(({ database }) => database === 'postgres') },
  (test, setup) => {
    it('keeps a change committed to a document below a renamed page while the move waits to write its row, and gives it its new path', async () => {
      const { payload } = test
      const tray = await create(payload, 'pages', { slug: 'tray', title: 'Tray' })
      const cup = await create(payload, 'pages', { parent: tray.id, slug: 'cup', title: 'Cup' })
      const commit = await holdRow(payload, 'pages', cup.id, { localized: setup.localized, title: 'Teacup' })

      const rename = update(payload, 'pages', tray.id, { slug: 'platter' })
      await waitForRowWait(payload)
      await commit()
      await rename

      const { path, title } = await readDocument(payload, 'pages', cup.id)
      expect({ path, title }).toEqual({ path: '/platter/cup', title: 'Teacup' })
    })

    it('keeps the title a document below a renamed page is saved with while the move is under way, with one latest version', async () => {
      const { payload } = test
      const shelf = await create(payload, 'pages', { slug: 'shelf', title: 'Shelf' })
      const first = await create(payload, 'pages', { parent: shelf.id, slug: 'first-book', title: 'First book' })
      const second = await create(payload, 'pages', { parent: shelf.id, slug: 'second-book', title: 'Second book' })
      const letGo = await holdRow(payload, 'pages', first.id)

      const rename = update(payload, 'pages', shelf.id, { slug: 'bookcase' })
      await waitForRowWait(payload)
      await update(payload, 'pages', second.id, { title: 'Second edition' })
      await letGo()
      await rename

      const { path, title } = await readDocument(payload, 'pages', second.id)
      expect({ latest: await countLatestVersions(payload, 'pages', second.id), path, title }).toEqual({
        latest: 1,
        path: '/bookcase/second-book',
        title: 'Second edition'
      })
    })

    // A document below that a save renames while the move is under way gives the documents below it
    // their paths, so the move leaves them.
    it('keeps the path a document below a renamed page gets from a rename of its parent saved while the move is under way', async () => {
      const { payload } = test
      const atlas = await create(payload, 'pages', { slug: 'atlas', title: 'Atlas' })
      const north = await create(payload, 'pages', { parent: atlas.id, slug: 'north', title: 'North' })
      const south = await create(payload, 'pages', { parent: atlas.id, slug: 'south', title: 'South' })
      const coast = await create(payload, 'pages', { parent: south.id, slug: 'coast', title: 'Coast' })
      const letGo = await holdRow(payload, 'pages', north.id)

      const rename = update(payload, 'pages', atlas.id, { slug: 'world' })
      await waitForRowWait(payload)
      await update(payload, 'pages', south.id, { slug: 'tropics' })
      await letGo()
      await rename

      expect({
        draft: await readPath(payload, 'pages', coast.id, { draft: true }),
        path: await readPath(payload, 'pages', coast.id)
      }).toEqual({ draft: '/world/tropics/coast', path: '/world/tropics/coast' })
    })
  }
)

// A move's write on the condition never lands on a row whose updatedAt Payload didn't write.
// setUpdatedAtNotWrittenByPayload says what such a row is and why Postgres is left out.
describeEachSetup(
  'a document whose updatedAt Payload did not write',
  { setups: SETUPS.filter(({ database }) => database !== 'postgres') },
  (test, setup) => {
    it('gives it its new path when a page above it is renamed, and leaves its other values', async () => {
      const { payload } = test
      const quay = await create(payload, 'pages', { slug: 'quay', title: 'Quay' })
      const crate = await create(payload, 'pages', { parent: quay.id, slug: 'crate', title: 'Crate' })
      await setUpdatedAtNotWrittenByPayload(payload, setup, 'pages', crate.id)
      // MongoDB stores the updatedAt of the write as a date, of the same moment as the text.
      const readRow = async (): Promise<Record<string, unknown>> => {
        const row = (await payload.db.findOne<{ [field: string]: unknown; id: Id; updatedAt: string }>({
          collection: 'pages',
          where: { id: { equals: crate.id } }
        }))!
        return { ...row, updatedAt: new Date(row.updatedAt).getTime() }
      }
      const before = await readRow()

      await update(payload, 'pages', quay.id, { slug: 'dock' })

      expect(await readPath(payload, 'pages', crate.id)).toBe('/dock/crate')
      expect({ ...(await readRow()), path: before.path }).toEqual(before)
    })
  }
)

// A move leaves a createdAt and an updatedAt that are no dates as the row holds them, since the
// adapter refuses that text in a write. setTimestampsThatAreNoDates says what such a row is and why
// only MongoDB has one.
describeEachSetup(
  'a document whose timestamps are no dates',
  { setups: SETUPS.filter(({ database }) => database === 'mongodb') },
  (test) => {
    it('gives it its new path when a page above it is renamed, and leaves its other values', async () => {
      const { payload } = test
      const wharf = await create(payload, 'pages', { slug: 'wharf', title: 'Wharf' })
      const bale = await create(payload, 'pages', { parent: wharf.id, slug: 'bale', title: 'Bale' })
      await setTimestampsThatAreNoDates(payload, 'pages', bale.id)
      const readRow = () =>
        payload.db.findOne<{ [field: string]: unknown; id: Id }>({ collection: 'pages', where: { id: { equals: bale.id } } })
      const before = (await readRow())!

      await update(payload, 'pages', wharf.id, { slug: 'pier' })

      expect(await readPath(payload, 'pages', bale.id)).toBe('/pier/bale')
      expect({ ...(await readRow()), path: before.path }).toEqual(before)
      expect(before).toMatchObject({ createdAt: 'not a date', updatedAt: 'not a date' })
    })
  }
)

// A collection with timestamps: false stores no updatedAt, so a move writes its rows by their ids.
// Payload requires timestamps for versions, which it keeps by default.
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
  (test) => {
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
