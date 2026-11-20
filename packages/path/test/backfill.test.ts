import { commitTransaction, createPayloadRequest, initTransaction, killTransaction } from 'payload'
import { beforeEach, expect, it, onTestFinished } from 'vitest'

import { backfillPaths, findByPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import type { Query } from './support/adapters.js'
import { describeEachSetup } from './support/boot-payload.js'
import {
  countLatestVersions,
  create,
  readDocument,
  readLatestVersion,
  readPath,
  remove,
  store,
  storeStrayPath,
  update
} from './support/documents.js'
import { holdRow, holdTable, refuseWritesOf, setUpdatedAtNotWrittenByPayload, waitForRowWait } from './support/raw-access.js'
import { SETUPS } from './support/setups.js'

const WRITES = ['delete', 'findAndModify', 'insert', 'update']

const writesOf = (queries: Query[]) => queries.filter(({ operation }) => WRITES.includes(operation))

describeEachSetup('', {}, (test, setup) => {
  beforeEach(() => {
    test.changes.length = 0
  })

  it('gives the documents a site already had their paths and ancestors, three levels deep, with drafts and without', async () => {
    const { payload } = test
    const guides = await store(test, setup, 'pages', { slug: 'guides', title: 'Guides' })
    const install = await store(test, setup, 'pages', { parent: guides, slug: 'install', title: 'Install' })
    const mac = await store(test, setup, 'pages', { parent: install, slug: 'mac', title: 'Mac' })
    const closures = await store(test, setup, 'notices', { slug: 'closures', title: 'Closures' })
    const easter = await store(test, setup, 'notices', { parent: closures, slug: 'easter', title: 'Easter' })
    const monday = await store(test, setup, 'notices', { parent: easter, slug: 'monday', title: 'Monday' })

    const report = await backfillPaths({ collections: ['pages', 'notices'], payload })

    expect(report).toMatchObject({ left: [], updated: 6 })
    for (const draft of [false, true]) {
      expect(await readDocument(payload, 'pages', guides, { draft })).toMatchObject({ ancestors: [], path: '/guides' })
      expect(await readDocument(payload, 'pages', mac, { draft })).toMatchObject({
        ancestors: [guides, install],
        path: '/guides/install/mac'
      })
    }
    expect(await readDocument(payload, 'notices', monday)).toMatchObject({
      ancestors: [closures, easter],
      path: '/closures/easter/monday'
    })
    expect(await findByPath({ path: '/guides/install', payload })).toMatchObject({ document: { id: install } })
    expect(await findByPath({ path: '/closures/easter', payload })).toMatchObject({ document: { id: easter } })
    // It made no version and ran no hook, so the site heard nothing.
    expect((await payload.db.countVersions({ collection: 'pages', where: { parent: { equals: mac } } })).totalDocs).toBe(1)
    expect(test.changes).toEqual([])
  })

  it('keeps a pending move pending', async () => {
    const { payload } = test
    const menu = await store(test, setup, 'pages', { slug: 'menu', title: 'Menu' }, { slug: 'food', title: 'Food' })
    const lunch = await store(test, setup, 'pages', { parent: menu, slug: 'lunch', title: 'Lunch' })

    expect(await backfillPaths({ collections: ['pages'], payload })).toMatchObject({ left: [], updated: 2 })

    expect(await readPath(payload, 'pages', menu)).toBe('/menu')
    expect(await readPath(payload, 'pages', menu, { draft: true })).toBe('/food')
    expect(await readLatestVersion(payload, 'pages', menu)).toMatchObject({
      _status: setup.localized ? { en: 'draft' } : 'draft'
    })
    expect(await readPath(payload, 'pages', lunch)).toBe('/menu/lunch')

    // The draft's publish carries the move out, with the page below.
    await update(payload, 'pages', menu, {})

    expect(await readPath(payload, 'pages', menu)).toBe('/food')
    expect(await readPath(payload, 'pages', lunch)).toBe('/food/lunch')
  })

  it('writes nothing in a second run', async () => {
    const { payload } = test
    const rooms = await store(test, setup, 'pages', { slug: 'rooms', title: 'Rooms' })
    await store(test, setup, 'pages', { parent: rooms, slug: 'suite', title: 'Suite' })
    await store(test, setup, 'notices', { slug: 'strike', title: 'Strike' })
    const first = await backfillPaths({ collections: ['pages', 'notices'], payload })

    let second
    const queries = await test.countQueries(async () => {
      second = await backfillPaths({ collections: ['pages', 'notices'], payload })
    })

    expect(first).toMatchObject({ left: [], updated: 3 })
    expect(second).toEqual({ left: [], updated: 0, unchanged: first.updated + first.unchanged })
    expect(writesOf(queries)).toEqual([])
  })

  it('leaves a document it cannot give a path, saying why as a save would, and gives the rest theirs', async () => {
    const { payload } = test
    const events = await create(payload, 'posts', { slug: 'events', title: 'Events' })
    const oldEvents = await store(test, setup, 'posts', { slug: 'events', title: 'Old events' })
    const summer = await store(test, setup, 'posts', { parent: oldEvents, slug: 'summer', title: 'Summer' })
    const admin = await store(test, setup, 'posts', { slug: 'admin', title: 'Admin' })
    const home = await store(test, setup, 'posts', { slug: 'home', title: 'Home' })
    const about = await store(test, setup, 'posts', { parent: home, slug: 'about', title: 'About' })
    const archive = await store(test, setup, 'posts', { slug: 'archive', title: 'Archive' })
    const year = await store(test, setup, 'posts', { parent: archive, slug: '2020', title: '2020' })

    const report = await backfillPaths({ collections: ['posts'], payload })

    const left = (id: Id, refusal: string) => ({ collection: 'posts', id, refusal })
    expect(report).toEqual({
      left: expect.arrayContaining([
        left(
          oldEvents,
          `Post "Events" is already at /events${setup.localized ? ' in en' : ''}, so change the slug or the parent.`
        ),
        left(summer, 'The parent has no path yet, so save the parent first.'),
        left(admin, 'The site serves the CMS at /admin, so pick another slug or a parent.'),
        left(about, "The home page can't hold posts, so pick another parent.")
      ]),
      updated: 3,
      unchanged: 1
    })
    expect(report.left).toHaveLength(4)
    expect(await findByPath({ path: '/events', payload })).toMatchObject({ document: { id: events.id } })
    expect(await findByPath({ path: '/', payload })).toMatchObject({ document: { id: home } })
    expect(await readPath(payload, 'posts', year)).toBe('/archive/2020')
    for (const id of [oldEvents, summer, admin, about]) expect((await readPath(payload, 'posts', id)) ?? null).toBeNull()
  })

  // Postgres and SQLite hold a parent as a foreign key, so only MongoDB can store one that is gone.
  if (setup.database === 'mongodb') {
    it("leaves a document whose parent doesn't exist", async () => {
      const { payload } = test
      const lost = await store(test, setup, 'notices', { parent: '0123456789abcdef01234567', slug: 'lost', title: 'Lost' })

      const report = await backfillPaths({ collections: ['notices'], payload })

      expect(report.left).toEqual([
        { collection: 'notices', id: lost, refusal: "The parent doesn't exist, so pick another one." }
      ])
    })
  }

  it('leaves a document without a slug, saying that it needs one, with drafts and without', async () => {
    const { payload } = test
    const before = await backfillPaths({ collections: ['pages', 'notices'], payload })
    const lobby = await store(test, setup, 'pages', { title: 'Lobby' })
    const lift = await store(test, setup, 'notices', { title: 'Lift out of order' })

    const report = await backfillPaths({ collections: ['pages', 'notices'], payload })

    const refusal = 'Give this document a slug, or a title to make one from.'
    expect(report).toEqual({
      left: expect.arrayContaining([
        ...before.left,
        { collection: 'pages', id: lobby, refusal },
        { collection: 'notices', id: lift, refusal }
      ]),
      updated: 0,
      unchanged: before.updated + before.unchanged
    })
    expect(report.left).toHaveLength(before.left.length + 2)
    expect((await readPath(payload, 'pages', lobby)) ?? null).toBeNull()
    expect((await readPath(payload, 'notices', lift)) ?? null).toBeNull()
  })

  // Two saves of the same path in the same instant can both pass, so two documents can store one path.
  // A page falls back to its English slug in Swedish, and a notice, without drafts, has no Swedish path.
  const storedAt = (path: string, locales = ['en', 'sv']) => ({
    path: setup.localized ? Object.fromEntries(locales.map((locale) => [locale, path])) : path
  })
  const takenBy = (document: string, path: string) =>
    `${document} is already at ${path}${setup.localized ? ' in en' : ''}, so change the slug or the parent.`

  it('leaves two documents that store the same path, each naming the other, and writes neither', async () => {
    const { payload } = test
    const first = await store(test, setup, 'pages', { slug: 'twins', title: 'First twin', ...storedAt('/twins') })
    // Its stored ancestors are not the ones its parent makes, so a run would write it.
    const second = await store(test, setup, 'pages', {
      ancestors: [first],
      slug: 'twins',
      title: 'Second twin',
      ...storedAt('/twins')
    })

    const report = await backfillPaths({ collections: ['pages'], payload })

    expect(report.left).toEqual(
      expect.arrayContaining([
        { collection: 'pages', id: first, refusal: takenBy('Page "Second twin"', '/twins') },
        { collection: 'pages', id: second, refusal: takenBy('Page "First twin"', '/twins') }
      ])
    )
    expect(await readDocument(payload, 'pages', second)).toMatchObject({ ancestors: [first] })
  })

  it('leaves a document that stores the path of a document in a collection the run was not asked for', async () => {
    const { payload } = test
    const desk = await store(test, setup, 'pages', { slug: 'desk', title: 'Desk', ...storedAt('/desk') })
    await store(test, setup, 'notices', { slug: 'desk', title: 'Desk moved', ...storedAt('/desk', ['en']) })

    const report = await backfillPaths({ collections: ['pages'], payload })

    expect(report.left).toContainEqual({ collection: 'pages', id: desk, refusal: takenBy('Notice "Desk moved"', '/desk') })
    expect(report.left.filter(({ collection }) => collection === 'notices')).toEqual([])
  })
})

// A site may run the backfill in a transaction of its own, such as a migration's, by giving it that
// transaction's request.
describeEachSetup('given a request', {}, (test, setup) => {
  it('writes in the transaction of the request, so its writes are undone with it', async () => {
    const { payload } = test
    const shelf = await store(test, setup, 'pages', { slug: 'shelf', title: 'Shelf' })
    const req = await createPayloadRequest({ payload })
    await initTransaction(req)

    const report = await backfillPaths({ payload, req })
    await killTransaction(req)

    expect(report).toEqual({ left: [], updated: 1, unchanged: 0 })
    expect((await readPath(payload, 'pages', shelf)) ?? null).toBeNull()
  })
})

// A migration that changes a table holds it until its transaction ends, and Postgres makes every
// other connection wait for it. So a backfill in that migration reads and writes on the migration's
// own connection, or it would wait for the migration that waits for it.
describeEachSetup(
  'in a migration that changed the table',
  { setups: SETUPS.filter(({ database }) => database === 'postgres') },
  (test, setup) => {
    it('gives the documents their paths in the transaction of the request it is given', async () => {
      const { payload } = test
      const cabinet = await store(test, setup, 'pages', { slug: 'cabinet', title: 'Cabinet' })
      const req = await createPayloadRequest({ payload })
      await initTransaction(req)
      // A run that waits for the table ends with the test, when the table is let go.
      onTestFinished(() => killTransaction(req))
      await holdTable(payload, 'pages', req)

      const report = await backfillPaths({ payload, req })
      await commitTransaction(req)

      expect(report).toEqual({ left: [], updated: 1, unchanged: 0 })
      expect(await readPath(payload, 'pages', cabinet)).toBe('/cabinet')
    })
  }
)

describeEachSetup(
  'with transactions off',
  { boot: { options: { collections: ['pages', 'posts'] }, transactions: false } },
  (test, setup) => {
    it('puts right a move that stopped halfway', async () => {
      const { payload } = test
      const atlas = await create(payload, 'pages', { slug: 'atlas', title: 'Atlas' })
      const branch = await create(payload, 'pages', { parent: atlas.id, slug: 'branch', title: 'Branch' })
      const leaf = await create(payload, 'pages', { parent: branch.id, slug: 'leaf', title: 'Leaf' })
      const globe = await create(payload, 'pages', { slug: 'globe', title: 'Globe' })
      // The database refuses the write of the ancestors of the last page of the branch, after the
      // paths below moved.
      await refuseWritesOf(test, setup, { ancestorsOf: leaf.id, collection: 'pages' }, () =>
        expect(update(payload, 'pages', atlas.id, { parent: globe.id })).rejects.toThrow()
      )
      expect(await readPath(payload, 'pages', atlas.id)).toBe('/globe/atlas')
      expect(await readDocument(payload, 'pages', leaf.id)).toMatchObject({
        ancestors: [atlas.id, branch.id],
        path: '/globe/atlas/branch/leaf'
      })

      const report = await backfillPaths({ payload })

      expect(report).toEqual({ left: [], updated: 2, unchanged: 2 })
      for (const draft of [false, true]) {
        expect(await readDocument(payload, 'pages', branch.id, { draft })).toMatchObject({
          ancestors: [globe.id, atlas.id],
          path: '/globe/atlas/branch'
        })
        expect(await readDocument(payload, 'pages', leaf.id, { draft })).toMatchObject({
          ancestors: [globe.id, atlas.id, branch.id],
          path: '/globe/atlas/branch/leaf'
        })
      }
    })

    it('puts right a move that stopped after its statements, before the write of a row of its own', async () => {
      const { payload } = test
      const chart = await create(payload, 'pages', { slug: 'chart', title: 'Chart' })
      const sheet = await create(payload, 'pages', { parent: chart.id, slug: 'sheet', title: 'Sheet' })
      const corner = await create(payload, 'pages', { parent: sheet.id, slug: 'corner', title: 'Corner' })
      const margin = await create(payload, 'pages', { parent: chart.id, slug: 'margin', title: 'Margin' })
      // Its path doesn't start with the renamed page's, so the statements leave its row and it gets a
      // write of its own after them, which the database refuses.
      await storeStrayPath(payload, setup, 'pages', margin.id, '/chart-annex/margin')
      await refuseWritesOf(test, setup, { collection: 'pages', id: margin.id }, () =>
        expect(update(payload, 'pages', chart.id, { slug: 'map' })).rejects.toThrow()
      )
      expect(await readPath(payload, 'pages', corner.id)).toBe('/map/sheet/corner')
      expect(await readPath(payload, 'pages', margin.id)).toBe('/chart-annex/margin')

      const report = await backfillPaths({ payload })

      expect(report.left).toEqual([])
      for (const draft of [false, true]) {
        for (const [id, ancestors, path] of [
          [sheet.id, [chart.id], '/map/sheet'],
          [corner.id, [chart.id, sheet.id], '/map/sheet/corner'],
          [margin.id, [chart.id], '/map/margin']
        ] as const) {
          expect(await readDocument(payload, 'pages', id, { draft })).toMatchObject({ ancestors, parent: ancestors.at(-1), path })
        }
      }
    })

    // The statements of a lift write the paths below, then the parent of the documents right below,
    // then their ancestors. A lift that stops in between leaves the deleted document where it was, and
    // the documents below it hanging from its parent, with ancestors that still hold it.
    it('puts right the documents below a delete that stopped between the parent and the ancestors of its lift', async () => {
      const { payload } = test
      const company = await create(payload, 'pages', { slug: 'company', title: 'Company' })
      const team = await create(payload, 'pages', { parent: company.id, slug: 'team', title: 'Team' })
      const people = await create(payload, 'pages', { parent: team.id, slug: 'people', title: 'People' })
      const hiring = await create(payload, 'pages', { parent: people.id, slug: 'hiring', title: 'Hiring' })
      const values = await create(payload, 'pages', { parent: team.id, slug: 'values', title: 'Values' })
      await refuseWritesOf(test, setup, { ancestorsOf: people.id, collection: 'pages' }, () =>
        expect(remove(payload, 'pages', team.id)).rejects.toThrow()
      )
      expect(await readDocument(payload, 'pages', people.id)).toMatchObject({
        ancestors: [company.id, team.id],
        parent: company.id,
        path: '/company/people'
      })

      const report = await backfillPaths({ payload })

      expect(report.left).toEqual([])
      expect(await readPath(payload, 'pages', team.id)).toBe('/company/team')
      for (const [id, ancestors, path] of [
        [people.id, [company.id], '/company/people'],
        [hiring.id, [company.id, people.id], '/company/people/hiring'],
        [values.id, [company.id], '/company/values']
      ] as const) {
        expect(await readDocument(payload, 'pages', id)).toMatchObject({ ancestors, parent: ancestors.at(-1), path })
      }
    })

    it('asks for collections the plugin was given', async () => {
      await expect(backfillPaths({ collections: ['pages', 'notices'], payload: test.payload })).rejects.toThrow(
        "@payloadpack/path was asked for collections that pathPlugin() wasn't given: notices."
      )
    })
  }
)

// A backfill's write on the condition never lands on a row whose updatedAt Payload didn't write.
// setUpdatedAtNotWrittenByPayload says what such a row is and why Postgres is left out.
describeEachSetup(
  'a document whose updatedAt Payload did not write',
  { setups: SETUPS.filter(({ database }) => database !== 'postgres') },
  (test, setup) => {
    it('gives it its path, and keeps its slug, title and updatedAt', async () => {
      const { payload } = test
      const path = setup.localized ? { en: '/old-attic' } : '/old-attic'
      const attic = await store(test, setup, 'pages', { path, slug: 'attic', title: 'Attic' })
      await setUpdatedAtNotWrittenByPayload(payload, setup, 'pages', attic)
      // MongoDB stores the updatedAt of the write as a date, of the same moment as the text.
      const readUpdatedAt = async () => {
        const row = await payload.db.findOne<{ id: Id; updatedAt: string }>({
          collection: 'pages',
          where: { id: { equals: attic } }
        })
        return new Date(row!.updatedAt).getTime()
      }
      const updatedAt = await readUpdatedAt()

      const report = await backfillPaths({ collections: ['pages'], payload })

      expect(report).toMatchObject({ left: [], updated: 1 })
      expect(await readDocument(payload, 'pages', attic)).toMatchObject({ path: '/attic', slug: 'attic', title: 'Attic' })
      expect(await readUpdatedAt()).toBe(updatedAt)
    })
  }
)

// A backfill reads each document again when it gets to it, and writes its row only while it is as it
// was read, so a save that lands while the run is under way is kept. Step by step on Postgres without
// transactions: a statement of the test holds the row of a page that stores another path than its
// slug makes, so the run waits to write it. Meanwhile the page below it, which the run comes to after
// it, is saved, or the held row itself is changed before it is let go. Holding a row so that a write
// waits for it is Postgres's, so the other databases are left out: SQLite has one writer at a time.
describeEachSetup(
  'a backfill that waits to write a row, transactions off',
  { boot: { transactions: false }, setups: SETUPS.filter(({ database }) => database === 'postgres') },
  (test, setup) => {
    it('keeps the title a document is saved with while the backfill is under way, with one latest version', async () => {
      const { payload } = test
      const path = setup.localized ? { en: '/old-cellar' } : '/old-cellar'
      const cellar = await store(test, setup, 'pages', { path, slug: 'cellar', title: 'Cellar' })
      const vintage = await store(test, setup, 'pages', { parent: cellar, slug: 'vintage', title: 'Vintage' })
      const letGo = await holdRow(payload, setup, 'pages', cellar)

      const backfill = backfillPaths({ collections: ['pages'], payload })
      const backfillWaited = await waitForRowWait(payload)
      await update(payload, 'pages', vintage, { title: 'Vintage, restocked' })
      await letGo()
      await backfill

      const { path: vintagePath, title } = await readDocument(payload, 'pages', vintage)
      expect({ backfillWaited, latest: await countLatestVersions(payload, 'pages', vintage), path: vintagePath, title }).toEqual({
        backfillWaited: true,
        latest: 1,
        path: '/cellar/vintage',
        title: 'Vintage, restocked'
      })
    })

    it('keeps a change committed to a document while the backfill waits to write its row, and gives it its path', async () => {
      const { payload } = test
      const path = setup.localized ? { en: '/old-pantry' } : '/old-pantry'
      const pantry = await store(test, setup, 'pages', { path, slug: 'pantry', title: 'Pantry' })
      const commit = await holdRow(payload, setup, 'pages', pantry, { savedTitle: 'Larder' })

      const backfill = backfillPaths({ collections: ['pages'], payload })
      const backfillWaited = await waitForRowWait(payload)
      await commit()
      const report = await backfill

      expect(report).toMatchObject({ left: [], updated: 1 })
      const { path: pantryPath, title } = await readDocument(payload, 'pages', pantry)
      expect({ backfillWaited, path: pantryPath, title }).toEqual({ backfillWaited: true, path: '/pantry', title: 'Larder' })
    })
  }
)
