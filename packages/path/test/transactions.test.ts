import { commitTransaction, createPayloadRequest, initTransaction, killTransaction, type Payload } from 'payload'
import { expect, it, onTestFinished } from 'vitest'

import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup } from './support/boot-payload.js'
import {
  catchFieldErrors,
  create,
  readDocument,
  readPath,
  readRows,
  remove,
  restoreVersion,
  update
} from './support/documents.js'
import { holdRow, isRowFree, refuseWritesOf, waitForRowWait } from './support/raw-access.js'

describeEachSetup('', {}, (test, setup) => {
  it('leaves every path, ancestor and version as it was when a move fails at one of its writes', async () => {
    const { payload } = test
    const atlas = await create(payload, 'pages', { slug: 'atlas', title: 'Atlas' })
    const branch = await create(payload, 'pages', { parent: atlas.id, slug: 'branch', title: 'Branch' })
    const leaf = await create(payload, 'pages', { parent: branch.id, slug: 'leaf', title: 'Leaf' })
    const globe = await create(payload, 'pages', { slug: 'globe', title: 'Globe' })

    // The database refuses the write of the paths of the latest versions below the page, after the
    // documents below moved.
    await refuseWritesOf(test, setup, { collection: 'pages', path: '/globe/atlas/branch/leaf', versions: true }, () =>
      expect(update(payload, 'pages', atlas.id, { parent: globe.id })).rejects.toThrow()
    )

    expect(await readPath(payload, 'pages', atlas.id)).toBe('/atlas')
    expect(await readPath(payload, 'pages', branch.id)).toBe('/atlas/branch')
    expect(await readPath(payload, 'pages', leaf.id)).toBe('/atlas/branch/leaf')
    expect(await readPath(payload, 'pages', leaf.id, { draft: true })).toBe('/atlas/branch/leaf')
    const stored = await readDocument(payload, 'pages', leaf.id)
    expect(stored.ancestors).toEqual([atlas.id, branch.id])
    expect(await readPath(payload, 'pages', atlas.id, { draft: true })).toBe('/atlas')
    expect((await readDocument(payload, 'pages', atlas.id)).parent).toBeFalsy()
  })

  it('leaves every path and version as it was when a rename fails at one of its writes', async () => {
    const { payload } = test
    const almanac = await create(payload, 'pages', { slug: 'almanac', title: 'Almanac' })
    const season = await create(payload, 'pages', { parent: almanac.id, slug: 'season', title: 'Season' })
    const tide = await create(payload, 'pages', { parent: season.id, slug: 'tide', title: 'Tide' })

    // The database refuses the last write the rename makes: the latest versions below the page.
    await refuseWritesOf(test, setup, { collection: 'pages', path: '/calendar/season/tide', versions: true }, () =>
      expect(update(payload, 'pages', almanac.id, { slug: 'calendar' })).rejects.toThrow()
    )

    for (const draft of [false, true]) {
      expect(await readPath(payload, 'pages', almanac.id, { draft })).toBe('/almanac')
      expect(await readPath(payload, 'pages', season.id, { draft })).toBe('/almanac/season')
      expect(await readPath(payload, 'pages', tide.id, { draft })).toBe('/almanac/season/tide')
    }
  })

  // MongoDB doesn't support parallel operations in one transaction. The SQL adapters run one statement
  // at a time on a connection. A bulk operation is left out: Payload runs its documents in parallel.
  if (setup.database === 'mongodb') {
    it('runs one query at a time inside the transaction of a move and a delete', async () => {
      const { payload } = test
      const garden = await create(payload, 'pages', { slug: 'garden', title: 'Garden' })
      const shed = await create(payload, 'pages', { parent: garden.id, slug: 'shed', title: 'Shed' })
      await create(payload, 'pages', { parent: shed.id, slug: 'tools', title: 'Tools' })
      const yard = await create(payload, 'pages', { slug: 'yard', title: 'Yard' })

      const queries = await test.countQueries(async () => {
        await update(payload, 'pages', garden.id, { parent: yard.id })
        await remove(payload, 'pages', garden.id)
      })

      expect(queries.filter(({ parallel }) => parallel)).toEqual([])
    })
  }

  // Two saves in one branch at once wait for each other's rows, and must not each hold a row the other
  // waits for. Step by step on Postgres with transactions: a statement of the test holds a row of the
  // branch, so a rename of the page at the top waits for it, and another connection then tries to lock
  // a row the rename may hold. Payload's write of a document holds its row so that the foreign key
  // check of another save that names it as an ancestor waits, so the move takes its rows before it.
  // Holding a row so that a write waits for it is Postgres's, and without transactions nothing is held.
  if (setup.database === 'postgres') {
    it("lets the foreign key check of another save through to the renamed page's row while the rename waits", async () => {
      const { payload } = test
      const ridge = await create(payload, 'pages', { slug: 'ridge', title: 'Ridge' })
      const slope = await create(payload, 'pages', { parent: ridge.id, slug: 'slope', title: 'Slope' })
      const cairn = await create(payload, 'pages', { parent: slope.id, slug: 'cairn', title: 'Cairn' })
      const letGo = await holdRow(payload, setup, 'pages', cairn.id)

      const rename = update(payload, 'pages', ridge.id, { slug: 'crest' })
      const renameWaited = await waitForRowWait(payload)
      const ridgeRowIsFree = await isRowFree(payload, setup, 'pages', ridge.id, 'KEY SHARE')
      await letGo()
      await rename

      expect({
        cairn: await readPath(payload, 'pages', cairn.id),
        renameWaited,
        ridgeRowIsFree,
        slope: await readPath(payload, 'pages', slope.id)
      }).toEqual({ cairn: '/crest/slope/cairn', renameWaited: true, ridgeRowIsFree: true, slope: '/crest/slope' })
    })

    // A save that waits for a move above it to end finds its document moved, and gives the rows below
    // the paths and ancestors they have below where it is now. The save above stays open in a
    // transaction of the test until the save below waits for it.
    it.each([
      { name: 'a rename below a rename', kind: 'rename' },
      { name: 'a move below a move', kind: 'move' }
    ] as const)(
      'moves the documents below $name that waited for the one above with the same statements for 30 below as for 3',
      async ({ kind }) => {
        const { payload } = test
        // Atlas, harbor and quay at the top level, a branch below atlas and rows below the branch. Atlas
        // is saved, the branch is saved while atlas's save holds the branch, and the statements of the
        // branch's save are returned, once each row is where its slug and parent put it.
        const readStatementsOfSaveThatWaited = async (size: number) => {
          const prefix = `${kind}-${size}`
          const [atlas, harbor, quay] = await Promise.all(
            ['atlas', 'harbor', 'quay'].map(
              async (top) => (await create(payload, 'pages', { slug: `${prefix}-${top}`, title: top })).id
            )
          )
          const branch = (await create(payload, 'pages', { parent: atlas, slug: 'branch', title: 'Branch' })).id
          const rows = await Promise.all(
            Array.from(
              { length: size },
              async (_, number) => (await create(payload, 'pages', { parent: branch, slug: `row-${number}`, title: 'Row' })).id
            )
          )
          const { above, ancestors, below, path } =
            kind === 'rename'
              ? {
                  above: { slug: `${prefix}-atlas-renamed` },
                  ancestors: [atlas, branch],
                  below: { slug: 'branch-renamed' },
                  path: `/${prefix}-atlas-renamed/branch-renamed`
                }
              : { above: { parent: harbor }, ancestors: [quay, branch], below: { parent: quay }, path: `/${prefix}-quay/branch` }
          const req = await createPayloadRequest({ payload })
          await initTransaction(req)
          onTestFinished(() => killTransaction(req))
          await update(payload, 'pages', atlas!, above, { req })

          let saveWaited = false
          const queries = await test.countQueries(async () => {
            const save = update(payload, 'pages', branch, below)
            saveWaited = await waitForRowWait(payload)
            await commitTransaction(req)
            await save
          })

          expect(saveWaited).toBe(true)
          for (const draft of [false, true]) {
            expect(await readDocument(payload, 'pages', branch, { draft })).toMatchObject({
              ancestors: ancestors.slice(0, -1),
              path
            })
            for (const [number, row] of rows.entries()) {
              expect(await readDocument(payload, 'pages', row, { draft })).toMatchObject({
                ancestors,
                path: `${path}/row-${number}`
              })
            }
          }
          // What waitForRowWait asks, and the commit of atlas's save, are no statements of the save.
          return queries
            .filter(({ operation, sql }) => operation !== 'commit' && !sql?.text.includes('pg_stat_activity'))
            .map(({ collection, operation }) => `${operation} ${collection}`)
        }

        expect(await readStatementsOfSaveThatWaited(30)).toEqual(await readStatementsOfSaveThatWaited(3))
      }
    )

    it('holds no row below the row the rename of a page waits for', async () => {
      const { payload } = test
      const delta = await create(payload, 'pages', { slug: 'delta', title: 'Delta' })
      const channel = await create(payload, 'pages', { parent: delta.id, slug: 'channel', title: 'Channel' })
      const islets = await Promise.all(
        Array.from(
          { length: 30 },
          async (_, number) =>
            (await create(payload, 'pages', { parent: channel.id, slug: `islet-${number}`, title: 'Islet' })).id
        )
      )
      const letGo = await holdRow(payload, setup, 'pages', channel.id)

      const rename = update(payload, 'pages', delta.id, { slug: 'estuary' })
      const renameWaited = await waitForRowWait(payload)
      const heldIslets: Id[] = []
      for (const islet of islets) if (!(await isRowFree(payload, setup, 'pages', islet, 'NO KEY UPDATE'))) heldIslets.push(islet)
      await letGo()
      await rename

      const isletPaths = await Promise.all(islets.map((islet) => readPath(payload, 'pages', islet)))
      expect({ heldIslets, isletPaths, renameWaited }).toEqual({
        heldIslets: [],
        isletPaths: islets.map((_, number) => `/estuary/channel/islet-${number}`),
        renameWaited: true
      })
    })
  }
})

type Row = { id: Id }

const byId = (rows: Row[]) => [...rows].sort((row, other) => String(row.id).localeCompare(String(other.id)))

// Every row of the collections and of their versions, as the database holds them.
async function readEveryRow(payload: Payload) {
  const rows: Record<string, Row[]> = {}
  for (const collection of ['pages', 'posts', 'notices']) {
    rows[collection] = byId((await payload.db.find<Row>({ collection, pagination: false })).docs)
    if (payload.collections[collection]!.config.versions?.drafts) {
      rows[`${collection} versions`] = byId((await payload.db.findVersions({ collection, pagination: false })).docs)
    }
  }
  return rows
}

type Refusal = {
  message: RegExp | string
  name: string
  // Stores what the refused save meets, and returns that save.
  prepare: (payload: Payload) => Promise<() => Promise<unknown>>
}

// The refusals an editor meets every day. Each one comes before anything is written.
const REFUSALS: Refusal[] = [
  {
    message: 'Page "Taken" is already at this path, so change the slug or the parent.',
    name: 'a new document at a taken path',
    prepare: async (payload) => {
      await create(payload, 'pages', { slug: 'taken', title: 'Taken' })
      return () => create(payload, 'pages', { slug: 'taken', title: 'Second' })
    }
  },
  {
    message: 'Page "Occupied" is already at this path, so change the slug or the parent.',
    name: 'a rename to a taken path',
    prepare: async (payload) => {
      await create(payload, 'pages', { slug: 'occupied', title: 'Occupied' })
      const renamed = await create(payload, 'pages', { slug: 'renamed', title: 'Renamed' })
      return () => update(payload, 'pages', renamed.id, { slug: 'occupied' })
    }
  },
  {
    message: 'Page "First" is already at this path, so change the slug or the parent.',
    name: 'the publish of a pending move to a path taken since',
    prepare: async (payload) => {
      const first = await create(payload, 'pages', { slug: 'first', title: 'First' })
      const second = await create(payload, 'pages', { slug: 'second', title: 'Second' })
      await update(payload, 'pages', first.id, { slug: 'pending' }, { draft: true })
      await update(payload, 'pages', second.id, { slug: 'pending' }, { draft: true })
      await update(payload, 'pages', first.id, {})
      return () => update(payload, 'pages', second.id, {})
    }
  },
  {
    message: 'The site serves the CMS at /admin, so pick another slug or a parent.',
    name: 'a reserved segment',
    prepare: async (payload) => {
      const help = await create(payload, 'pages', { slug: 'help', title: 'Help' })
      return () => update(payload, 'pages', help.id, { slug: 'admin' })
    }
  },
  {
    message: "A document can't sit below itself, so pick another parent.",
    name: 'a parent below the document itself',
    prepare: async (payload) => {
      const shelf = await create(payload, 'pages', { slug: 'shelf', title: 'Shelf' })
      const box = await create(payload, 'pages', { parent: shelf.id, slug: 'box', title: 'Box' })
      return () => update(payload, 'pages', shelf.id, { parent: box.id })
    }
  },
  {
    message: "The home page can't hold pages, so pick another parent.",
    name: 'the home page as a parent',
    prepare: async (payload) => {
      const home = await create(payload, 'pages', { slug: 'home', title: 'Home' })
      return () => create(payload, 'pages', { parent: home.id, slug: 'news', title: 'News' })
    }
  },
  {
    message: 'Post "Ledger post" is already at /blog/ledger, so change the slug or the parent.',
    name: 'the publish of a pending move that lands a page of the branch on a taken path',
    prepare: async (payload) => {
      await create(payload, 'posts', { slug: 'ledger', title: 'Ledger post' })
      const tally = await create(payload, 'pages', { slug: 'tally', title: 'Tally' })
      await create(payload, 'pages', { parent: tally.id, slug: 'ledger', title: 'Ledger page' })
      await update(payload, 'pages', tally.id, { slug: 'blog' }, { draft: true })
      return () => update(payload, 'pages', tally.id, {})
    }
  },
  {
    message: 'Post "Recipes post" is already at /blog/recipes, so change the slug or the parent.',
    name: 'a move that lands a page of the branch on a taken path',
    prepare: async (payload) => {
      await create(payload, 'posts', { slug: 'recipes', title: 'Recipes post' })
      const journal = await create(payload, 'pages', { slug: 'journal', title: 'Journal' })
      await create(payload, 'pages', { parent: journal.id, slug: 'recipes', title: 'Recipes page' })
      return () => update(payload, 'pages', journal.id, { slug: 'blog' })
    }
  },
  {
    message: 'Page "Press" is already at /press, so change the slug or the parent.',
    name: 'a delete that lifts a page onto a taken path',
    prepare: async (payload) => {
      await create(payload, 'pages', { slug: 'press', title: 'Press' })
      const media = await create(payload, 'pages', { slug: 'media', title: 'Media' })
      await create(payload, 'pages', { parent: media.id, slug: 'press', title: 'Press kit' })
      return () => remove(payload, 'pages', media.id)
    }
  }
]

for (const transactions of [true, false]) {
  describeEachSetup(
    `with transactions ${transactions ? 'on' : 'off'}`,
    {
      boot: {
        options: { collections: ['pages', { basePath: '/blog', slug: 'posts' }, 'notices'] },
        transactions
      }
    },
    (test) => {
      it.each(REFUSALS)('refuses $name before anything is written', async ({ message, prepare }) => {
        const { payload } = test
        const save = await prepare(payload)
        const before = await readEveryRow(payload)

        expect(await catchFieldErrors(save())).toMatchObject([{ message }])
        expect(await readEveryRow(payload)).toEqual(before)
      })

      it('ends a create, a rename with pages below, a publish of a pending move, a change of parent and a delete with pages below in the same state', async () => {
        const { payload } = test
        const harbour = await create(payload, 'pages', { slug: 'harbour', title: 'Harbour' })
        const ferries = await create(payload, 'pages', { parent: harbour.id, slug: 'ferries', title: 'Ferries' })
        const timetable = await create(payload, 'pages', { parent: ferries.id, slug: 'timetable', title: 'Timetable' })
        const coast = await create(payload, 'pages', { slug: 'coast', title: 'Coast' })

        await update(payload, 'pages', harbour.id, { slug: 'port' })
        await update(payload, 'pages', ferries.id, { slug: 'boats' }, { draft: true })
        await update(payload, 'pages', ferries.id, {})
        expect(await readPath(payload, 'pages', timetable.id)).toBe('/port/boats/timetable')
        await update(payload, 'pages', harbour.id, { parent: coast.id })
        await remove(payload, 'pages', ferries.id)

        for (const draft of [false, true]) {
          expect(await readDocument(payload, 'pages', harbour.id, { draft })).toMatchObject({
            ancestors: [coast.id],
            parent: coast.id,
            path: '/coast/port'
          })
          expect(await readDocument(payload, 'pages', timetable.id, { draft })).toMatchObject({
            ancestors: [coast.id, harbour.id],
            parent: harbour.id,
            path: '/coast/port/timetable'
          })
        }
      })

      // An unpublish writes the latest draft to the document, so a pending move happens with it. The
      // plugin knows from the operation that the save is no draft save, so it refuses before the write.
      it('refuses to unpublish a page with a pending rename whose branch would land on a taken path, and leaves it as it was', async () => {
        const { payload } = test
        // A page with a pending rename to blog: the page itself would be at /blog, which is free, and
        // the page below it at /blog/abacus-ledger, where a post is.
        await create(payload, 'posts', { slug: 'abacus-ledger', title: 'abacus ledger post' })
        const page = await create(payload, 'pages', { slug: 'abacus', title: 'abacus' })
        const below = await create(payload, 'pages', { parent: page.id, slug: 'abacus-ledger', title: 'abacus ledger' })
        await update(payload, 'pages', page.id, { slug: 'blog' }, { draft: true })
        const before = await readRows(payload, 'pages', [page.id, below.id])

        // As the admin's Unpublish button saves: the status alone, without draft.
        expect(
          await catchFieldErrors(
            payload.update({ collection: 'pages', data: { _status: 'draft' }, id: page.id, overrideAccess: true })
          )
        ).toMatchObject([
          { message: 'Post "abacus ledger post" is already at /blog/abacus-ledger, so change the slug or the parent.' }
        ])
        expect(await readRows(payload, 'pages', [page.id, below.id])).toEqual(before)
      })

      // A version restored as the document is written to the document itself, whatever its status.
      it('refuses to restore a draft version of a page whose branch would land on a taken path, and leaves it as it was', async () => {
        const { payload } = test
        await create(payload, 'posts', { slug: 'ledger-roll', title: 'ledger roll post' })
        const page = await create(payload, 'pages', { slug: 'roll', title: 'roll' })
        const below = await create(payload, 'pages', { parent: page.id, slug: 'ledger-roll', title: 'ledger roll' })
        await update(payload, 'pages', page.id, { slug: 'blog' }, { draft: true })
        const before = await readRows(payload, 'pages', [page.id, below.id])

        // The second version is the draft that renamed the page.
        expect(await catchFieldErrors(restoreVersion(payload, 'pages', page.id, { version: 1 }))).toMatchObject([
          { message: 'Post "ledger roll post" is already at /blog/ledger-roll, so change the slug or the parent.' }
        ])
        expect(await readRows(payload, 'pages', [page.id, below.id])).toEqual(before)
      })

      // A bulk unpublish alone moves nothing, because Payload's bulk update saves each document as it is
      // published, without its latest draft. One that also sends a slug moves the page.
      it('lists a page that a bulk update unpublishes and renames in its errors when its branch would land on a taken path, and leaves it as it was', async () => {
        const { payload } = test
        await create(payload, 'posts', { slug: 'quill-case', title: 'quill case post' })
        const page = await create(payload, 'pages', { slug: 'quill', title: 'quill' })
        const below = await create(payload, 'pages', { parent: page.id, slug: 'quill-case', title: 'quill case' })
        const before = await readRows(payload, 'pages', [page.id, below.id])

        const { errors } = await payload.update({
          collection: 'pages',
          data: { _status: 'draft', slug: 'blog' },
          overrideAccess: true,
          where: { id: { equals: page.id } }
        })

        expect(errors).toMatchObject([{ id: page.id }])
        expect(await readRows(payload, 'pages', [page.id, below.id])).toEqual(before)
      })
    }
  )
}
