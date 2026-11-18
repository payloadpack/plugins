import { beforeEach, expect, it } from 'vitest'

import { backfillPaths, findByPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import type { Query } from './support/adapters.js'
import { describeEachSetup } from './support/boot-payload.js'
import { create, readDocument, readLatestVersion, readPath, store, update } from './support/documents.js'
import { refuseWritesOf } from './support/raw-access.js'

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
})

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
      // The database refuses the write of the last page of the branch, after the pages above it moved.
      await refuseWritesOf(test, setup, { collection: 'pages', id: leaf.id }, () =>
        expect(update(payload, 'pages', atlas.id, { parent: globe.id })).rejects.toThrow()
      )
      expect(await readPath(payload, 'pages', atlas.id)).toBe('/globe/atlas')
      expect(await readPath(payload, 'pages', leaf.id)).toBe('/atlas/branch/leaf')

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

    it('asks for collections the plugin was given', async () => {
      await expect(backfillPaths({ collections: ['pages', 'notices'], payload: test.payload })).rejects.toThrow(
        "@payloadpack/path was asked for collections that pathPlugin() wasn't given: notices."
      )
    })
  }
)
