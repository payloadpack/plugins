import type { Payload } from 'payload'
import { expect, it } from 'vitest'

import type { Id } from '../src/paths/place.js'
import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, remove, update } from './support/documents.js'
import { refuseWritesOf } from './support/raw-access.js'

describeEachSetup('', {}, (test, setup) => {
  it('leaves every path, ancestor and version as it was when a move fails at one of its writes', async () => {
    const { payload } = test
    const atlas = await create(payload, 'pages', { slug: 'atlas', title: 'Atlas' })
    const branch = await create(payload, 'pages', { parent: atlas.id, slug: 'branch', title: 'Branch' })
    const leaf = await create(payload, 'pages', { parent: branch.id, slug: 'leaf', title: 'Leaf' })
    const globe = await create(payload, 'pages', { slug: 'globe', title: 'Globe' })

    // The database refuses the last write the move makes: the latest versions below the page.
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
      await update(payload, 'pages', first.id, { slug: 'planned' }, { draft: true })
      await update(payload, 'pages', second.id, { slug: 'planned' }, { draft: true })
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
    }
  )
}
