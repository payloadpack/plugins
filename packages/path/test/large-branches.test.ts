import { commitTransaction, createPayloadRequest, initTransaction } from 'payload'
import { beforeAll, expect, it } from 'vitest'

import type { Id } from '../src/path/build-path-and-ancestors.js'
import { CHUNK_SIZE } from '../src/utils/in-chunks.js'
import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, remove, store, update } from './support/documents.js'

// The inner depot is the first document below and the spare crate the last, so they fall in the first
// chunk and in the last one. The documents below are stored without a path and given theirs by one
// rename of the depot, a fraction of a save each. The tests run in order on the one branch.

const LAST_CRATE = `crate-${CHUNK_SIZE - 1}`

describeEachSetup(
  'with a branch bigger than one chunk',
  { boot: { options: { collections: ['pages', { basePath: '/warehouse/depot', slug: 'posts' }, 'notices'] } } },
  (test, setup) => {
    const branch = {} as { depot: Id; firstCrate: Id; innerDepot: Id; lastCrate: Id; spareCrate: Id }

    beforeAll(async () => {
      const { payload } = test
      const { id: depot } = await create(payload, 'pages', { slug: 'shed', title: 'Depot' })
      // In one transaction, which MongoDB commits far sooner than a write at a time.
      const stored = { payload, req: await createPayloadRequest({ payload }) }
      await initTransaction(stored.req)
      const storeBelow = (parent: Id, ancestors: Id[], slug: string, title: string) =>
        store(stored, setup, 'pages', { ancestors, parent, slug, title })
      const innerDepot = await storeBelow(depot, [depot], 'depot', 'Inner depot')
      const crates: Id[] = []
      for (let number = 0; number < CHUNK_SIZE; number++) {
        crates.push(await storeBelow(depot, [depot], `crate-${number}`, `Crate ${number}`))
      }
      const spareCrate = await storeBelow(innerDepot, [depot, innerDepot], 'crate-0', 'Spare crate')
      await commitTransaction(stored.req)
      await update(payload, 'pages', depot, { slug: 'depot' })
      Object.assign(branch, { depot, firstCrate: crates[0], innerDepot, lastCrate: crates.at(-1), spareCrate })
      // A pending move in the last chunk.
      await update(payload, 'pages', spareCrate, { slug: 'spare' }, { draft: true })
      if (!setup.localized) return
      // The last crate isn't published in Swedish, so there it is where its draft's slug says. That
      // draft also has a parent outside the branch, so a move finds it only by asking for the
      // latest versions of the last chunk's documents.
      const annex = await create(payload, 'pages', { slug: 'annex', title: 'Annex' })
      await update(payload, 'pages', branch.lastCrate, { parent: annex.id, slug: 'reserv' }, { draft: true, locale: 'sv' })
    })

    it('refuses a move that would land a document of the last chunk on a taken path, and moves none', async () => {
      const { payload } = test
      await create(payload, 'posts', { slug: 'crate-0', title: 'Crate post' })

      expect(await catchFieldErrors(update(payload, 'pages', branch.depot, { slug: 'warehouse' }))).toMatchObject([
        { message: 'Post "Crate post" is already at /warehouse/depot/crate-0, so change the slug or the parent.', path: 'slug' }
      ])
      expect(await readPath(payload, 'pages', branch.depot)).toBe('/depot')
      expect(await readPath(payload, 'pages', branch.spareCrate)).toBe('/depot/depot/crate-0')
    })

    it('moves every document of the branch to a new parent, in its latest version too', async () => {
      const { payload } = test
      const yard = await create(payload, 'pages', { slug: 'yard', title: 'Yard' })

      await update(payload, 'pages', branch.depot, { parent: yard.id })

      expect(await readPath(payload, 'pages', branch.innerDepot)).toBe('/yard/depot/depot')
      expect(await readPath(payload, 'pages', branch.firstCrate)).toBe('/yard/depot/crate-0')
      expect(await readPath(payload, 'pages', branch.lastCrate)).toBe(`/yard/depot/${LAST_CRATE}`)
      expect(await readPath(payload, 'pages', branch.spareCrate)).toBe('/yard/depot/depot/crate-0')
      expect(await readPath(payload, 'pages', branch.spareCrate, { draft: true })).toBe('/yard/depot/depot/spare')
      if (setup.localized) expect(await readPath(payload, 'pages', branch.lastCrate, { locale: 'sv' })).toBe('/yard/depot/reserv')
      const below = { ancestors: { equals: yard.id } }
      expect(await payload.count({ collection: 'pages', overrideAccess: true, where: below })).toEqual({
        totalDocs: CHUNK_SIZE + 3
      })
    })

    it('lifts every document of the branch, also onto a path another document of the branch was at', async () => {
      const { payload } = test

      await remove(payload, 'pages', branch.depot)

      expect(await readPath(payload, 'pages', branch.innerDepot)).toBe('/yard/depot')
      expect(await readPath(payload, 'pages', branch.spareCrate)).toBe('/yard/depot/crate-0')
      expect(await readPath(payload, 'pages', branch.spareCrate, { draft: true })).toBe('/yard/depot/spare')
      expect(await readPath(payload, 'pages', branch.firstCrate)).toBe('/yard/crate-0')
      expect(await readPath(payload, 'pages', branch.lastCrate)).toBe(`/yard/${LAST_CRATE}`)
      if (setup.localized) expect(await readPath(payload, 'pages', branch.lastCrate, { locale: 'sv' })).toBe('/yard/reserv')
      const topOfBranch = { ancestors: { equals: branch.innerDepot } }
      expect(await payload.count({ collection: 'pages', overrideAccess: true, where: topOfBranch })).toEqual({ totalDocs: 1 })
    })

    it('gives every document of the branch its new path when the page it is lifted below is renamed, in its latest version too', async () => {
      const { payload } = test
      const { parent: yard } = await readDocument(payload, 'pages', branch.innerDepot)

      await update(payload, 'pages', yard as Id, { slug: 'court' })

      expect(await readPath(payload, 'pages', branch.innerDepot)).toBe('/court/depot')
      expect(await readPath(payload, 'pages', branch.spareCrate)).toBe('/court/depot/crate-0')
      expect(await readPath(payload, 'pages', branch.spareCrate, { draft: true })).toBe('/court/depot/spare')
      expect(await readPath(payload, 'pages', branch.firstCrate)).toBe('/court/crate-0')
      expect(await readPath(payload, 'pages', branch.lastCrate)).toBe(`/court/${LAST_CRATE}`)
      if (setup.localized) expect(await readPath(payload, 'pages', branch.lastCrate, { locale: 'sv' })).toBe('/court/reserv')
    })
  }
)
