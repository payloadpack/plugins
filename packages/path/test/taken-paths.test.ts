import { commitTransaction, createPayloadRequest, initTransaction, type Payload } from 'payload'
import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, create, remove, update } from './support/documents.js'

const takenBy = (document: string) => [
  { message: `${document} is already at this path, so change the slug or the parent.`, path: 'slug' }
]

describeEachSetup('', {}, (test) => {
  it('gives a duplicate the slug with -copy, or -copy-2 and up when that is in use, beside the published original', async () => {
    const { payload } = test
    const imprint = await create(payload, 'pages', { slug: 'imprint', title: 'Imprint' })
    const duplicate = () => payload.duplicate({ collection: 'pages', draft: true, id: imprint.id, overrideAccess: true })

    const copies = [await duplicate(), await duplicate()]

    expect(copies.map(({ path, slug }) => [slug, path])).toEqual([
      ['imprint-copy', '/imprint-copy'],
      ['imprint-copy-2', '/imprint-copy-2']
    ])
  })

  it('gives a duplicate below a parent the slug with -copy among the documents below that parent only', async () => {
    const { payload } = test
    const legal = await create(payload, 'pages', { slug: 'legal', title: 'Legal' })
    const terms = await create(payload, 'pages', { parent: legal.id, slug: 'terms', title: 'Terms' })
    // The same slug below another parent, and at the top level, is not in the way.
    await create(payload, 'pages', { slug: 'terms-copy', title: 'Terms copy' })
    const duplicate = () => payload.duplicate({ collection: 'pages', draft: true, id: terms.id, overrideAccess: true })

    const copies = [await duplicate(), await duplicate()]

    expect(copies.map(({ path, slug }) => [slug, path])).toEqual([
      ['terms-copy', '/legal/terms-copy'],
      ['terms-copy-2', '/legal/terms-copy-2']
    ])
  })

  it('refuses a path a document of a collection without drafts holds', async () => {
    const { payload } = test
    await create(payload, 'notices', { slug: 'parking', title: 'Parking' })

    expect(await catchFieldErrors(create(payload, 'pages', { slug: 'parking', title: 'Parking page' }))).toMatchObject(
      takenBy('Notice "Parking"')
    )
  })

  it('refuses a document of a collection without drafts at a path a page holds', async () => {
    const { payload } = test
    await create(payload, 'pages', { slug: 'opening-times', title: 'Opening times' })

    expect(
      await catchFieldErrors(create(payload, 'notices', { slug: 'opening-times', title: 'Opening times notice' }))
    ).toMatchObject(takenBy('Page "Opening times"'))
  })

  it('refuses a path a published document holds in another collection, naming it', async () => {
    const { payload } = test
    await create(payload, 'pages', { slug: 'plans', title: 'Plan A' })

    expect(await catchFieldErrors(create(payload, 'posts', { slug: 'plans', title: 'Plan B' }))).toMatchObject(
      takenBy('Page "Plan A"')
    )
    expect(await catchFieldErrors(create(payload, 'posts', { slug: 'plans', title: 'Plan C' }, { draft: true }))).toMatchObject(
      takenBy('Page "Plan A"')
    )
  })

  it('refuses a new draft at the path of another draft, naming it', async () => {
    const { payload } = test
    await create(payload, 'posts', { slug: 'sketches', title: 'Sketches one' }, { draft: true })

    expect(
      await catchFieldErrors(create(payload, 'posts', { slug: 'sketches', title: 'Sketches two' }, { draft: true }))
    ).toMatchObject(takenBy('Post "Sketches one"'))
    expect(await catchFieldErrors(create(payload, 'pages', { slug: 'sketches', title: 'Sketches page' }))).toMatchObject(
      takenBy('Post "Sketches one"')
    )
  })

  it('keeps the path of a page that is not published, until a draft rename frees it or the page is deleted', async () => {
    const { payload } = test
    const yard = await create(payload, 'pages', { slug: 'yard', title: 'Yard' })
    const shed = await create(payload, 'pages', { slug: 'shed', title: 'Shed' }, { draft: true })
    await update(payload, 'pages', yard.id, { _status: 'draft' })
    const garden = { slug: 'yard', title: 'Garden' }
    const hut = { slug: 'shed', title: 'Hut' }

    expect(await catchFieldErrors(create(payload, 'pages', garden))).toMatchObject(takenBy('Page "Yard"'))
    expect(await catchFieldErrors(create(payload, 'pages', hut))).toMatchObject(takenBy('Page "Shed"'))

    // A page that isn't published follows its draft at once, so its old path is free.
    await update(payload, 'pages', yard.id, { slug: 'back-yard' }, { draft: true })
    await remove(payload, 'pages', shed.id)

    expect((await create(payload, 'pages', garden)).path).toBe('/yard')
    expect((await create(payload, 'pages', hut)).path).toBe('/shed')
    expect(await catchFieldErrors(create(payload, 'posts', { slug: 'back-yard', title: 'Back yard post' }))).toMatchObject(
      takenBy('Page "Yard"')
    )
  })

  // Payload uses the context object a site passes as the request's own, and a site may pass one to
  // many operations.
  it('gives a document a path that a failed save with the same context object was about to take', async () => {
    const { payload } = test
    const shared = {}
    const attic = await create(payload, 'notices', { slug: 'attic', title: 'Attic' })
    const loft = await create(payload, 'notices', { slug: 'loft', title: 'Loft' })
    const saved = { collection: 'notices', context: shared, overrideAccess: true } as const

    // The path is free, and Payload then refuses the empty title.
    await expect(payload.update({ ...saved, data: { slug: 'roof', title: '' }, id: attic.id })).rejects.toThrow()
    const moved = await payload.update({ ...saved, data: { slug: 'roof' }, id: loft.id })

    expect(moved.path).toBe('/roof')
  })

  it('gives a document a path that an earlier save on the same request took and left', async () => {
    const { payload } = test
    const req = await createPayloadRequest({ payload })
    const porch = await create(payload, 'notices', { slug: 'porch', title: 'Porch' })
    const stoop = await create(payload, 'notices', { slug: 'stoop', title: 'Stoop' })
    const saved = { collection: 'notices', overrideAccess: true, req } as const

    await payload.update({ ...saved, data: { slug: 'veranda' }, id: porch.id })
    await payload.update({ ...saved, data: { slug: 'porch' }, id: porch.id })
    const moved = await payload.update({ ...saved, data: { slug: 'veranda' }, id: stoop.id })

    expect(moved.path).toBe('/veranda')
  })

  it('gives a document a path that a save on the same request was about to take before a required field refused it', async () => {
    const { payload } = test
    const req = await createPayloadRequest({ payload })
    const cellar = await create(payload, 'notices', { slug: 'cellar', title: 'Cellar' })
    const vault = await create(payload, 'notices', { slug: 'vault', title: 'Vault' })
    const saved = { collection: 'notices', overrideAccess: true, req } as const

    // The path is free, and Payload then refuses the empty title.
    await expect(payload.update({ ...saved, data: { slug: 'crypt', title: '' }, id: cellar.id })).rejects.toThrow()
    const moved = await payload.update({ ...saved, data: { slug: 'crypt' }, id: vault.id })

    expect(moved.path).toBe('/crypt')
  })

  // Payload skips what ends a bulk update when it fails as a whole, so the request still holds what
  // the bulk update started.
  it('gives a document a path that a save was refused at, on a request whose bulk update failed as a whole', async () => {
    const { payload } = test
    const req = await createPayloadRequest({ payload })
    const cabin = await create(payload, 'notices', { slug: 'cabin', title: 'Cabin' })
    const lodge = await create(payload, 'notices', { slug: 'lodge', title: 'Lodge' })
    const saved = { collection: 'notices', overrideAccess: true, req } as const

    // A request without a user may update no notice.
    await expect(
      payload.update({
        collection: 'notices',
        data: { title: 'Hut' },
        overrideAccess: false,
        req,
        where: { id: { in: [cabin.id, lodge.id] } }
      })
    ).rejects.toThrow('You are not allowed to perform this action.')
    // The path is free, and Payload then refuses the empty title.
    await expect(payload.update({ ...saved, data: { slug: 'chalet', title: '' }, id: cabin.id })).rejects.toThrow()
    const moved = await payload.update({ ...saved, data: { slug: 'chalet' }, id: lodge.id })

    expect(moved.path).toBe('/chalet')
  })
})

// A save in progress: a request whose transaction stays open until the test commits it.
async function openSave(payload: Payload) {
  const req = await createPayloadRequest({ payload })
  await initTransaction(req)
  return req
}

async function findPublishedAt(payload: Payload, path: string) {
  const { docs } = await payload.find({
    collection: 'pages',
    depth: 0,
    overrideAccess: true,
    pagination: false,
    where: { path: { equals: path }, _status: { equals: 'published' } }
  })
  return docs.map(({ id }) => id)
}

// A block of its own: on SQLite the save that could not begin leaves a connection behind, on which the
// next save fails at its commit.
describeEachSetup('with two saves of one path that overlap', {}, (test, setup) => {
  if (setup.database === 'sqlite') {
    it('fails the second save while the first is open, because SQLite has one writer at a time', async () => {
      const { payload } = test
      const first = await openSave(payload)
      const ferry = await create(payload, 'pages', { slug: 'crossing', title: 'Ferry' }, { req: first })

      await expect(create(payload, 'pages', { slug: 'crossing', title: 'Bridge' })).rejects.toThrow(
        'cannot begin transaction: SQLITE_BUSY: database is locked'
      )
      await commitTransaction(first)

      expect(await findPublishedAt(payload, '/crossing')).toEqual([ferry.id])
      expect(await findByPath({ path: '/crossing', payload })).toMatchObject({ document: { id: ferry.id } })
    })
  } else {
    // A stated limit: each save checks the path in its own transaction, which doesn't see the other's write.
    it('publishes both documents at the path, and refuses one of them only when it takes the path again', async () => {
      const { payload } = test
      const first = await openSave(payload)
      const ferry = await create(payload, 'pages', { slug: 'crossing', title: 'Ferry' }, { req: first })
      const second = await openSave(payload)
      const bridge = await create(payload, 'pages', { slug: 'crossing', title: 'Bridge' }, { req: second })
      await commitTransaction(first)
      await commitTransaction(second)

      const both = [ferry.id, bridge.id]
      expect(new Set(await findPublishedAt(payload, '/crossing'))).toEqual(new Set(both))
      // The site gets one of the two.
      expect(both).toContain((await findByPath({ path: '/crossing', payload }))?.document.id)
      // A later save that keeps the slug and the parent is not checked, so both stay.
      await update(payload, 'pages', ferry.id, { title: 'Ferry at dawn' })
      await update(payload, 'pages', bridge.id, { title: 'Bridge at dawn' })
      expect(await findPublishedAt(payload, '/crossing')).toHaveLength(2)
      // A document that left the path is checked when it takes it again.
      await update(payload, 'pages', ferry.id, { slug: 'ferry' })
      expect(await catchFieldErrors(update(payload, 'pages', ferry.id, { slug: 'crossing' }))).toMatchObject(
        takenBy('Page "Bridge at dawn"')
      )
      expect(await findPublishedAt(payload, '/crossing')).toEqual([bridge.id])
    })
  }
})
