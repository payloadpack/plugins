import type { CollectionConfig } from 'payload'
import { beforeEach, expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup } from './support/boot-payload.js'
import { create, readDocument, readPath } from './support/documents.js'
import { SETUPS } from './support/setups.js'

describeEachSetup('', {}, (test) => {
  it('moves several pages and the pages below them in one bulk update', async () => {
    const { payload } = test
    const library = await create(payload, 'pages', { slug: 'library', title: 'Library' })
    const fiction = await create(payload, 'pages', { slug: 'fiction', title: 'Fiction' })
    const poetry = await create(payload, 'pages', { slug: 'poetry', title: 'Poetry' })
    const sonnets = await create(payload, 'pages', { parent: poetry.id, slug: 'sonnets', title: 'Sonnets' })

    await payload.update({
      collection: 'pages',
      data: { _status: 'published', parent: library.id },
      overrideAccess: true,
      where: { id: { in: [fiction.id, poetry.id] } }
    })

    expect(await readPath(payload, 'pages', fiction.id)).toBe('/library/fiction')
    expect(await readPath(payload, 'pages', sonnets.id)).toBe('/library/poetry/sonnets')
  })

  it('lists the refused page of a bulk update in its errors, and saves the others', async () => {
    const { payload } = test
    const museum = await create(payload, 'pages', { slug: 'museum', title: 'Museum' })
    await create(payload, 'pages', { parent: museum.id, slug: 'armour', title: 'Armour hall' })
    const armour = await create(payload, 'pages', { slug: 'armour', title: 'Armour' })
    const coins = await create(payload, 'pages', { slug: 'coins', title: 'Coins' })
    const maps = await create(payload, 'pages', { slug: 'maps', title: 'Maps' })

    const { docs, errors } = await payload.update({
      collection: 'pages',
      data: { _status: 'published', parent: museum.id },
      overrideAccess: true,
      where: { id: { in: [armour.id, coins.id, maps.id] } }
    })

    expect(errors).toMatchObject([{ id: armour.id }])
    expect(docs.map(({ id }) => id).sort()).toEqual([coins.id, maps.id].sort())
    expect(await readPath(payload, 'pages', armour.id)).toBe('/armour')
    expect(await readPath(payload, 'pages', coins.id)).toBe('/museum/coins')
    expect(await readPath(payload, 'pages', maps.id)).toBe('/museum/maps')
  })

  it('lists the refused page of a bulk delete in its errors, and deletes the others', async () => {
    const { payload } = test
    await create(payload, 'pages', { slug: 'press', title: 'Press' })
    const media = await create(payload, 'pages', { slug: 'media', title: 'Media' })
    const press = await create(payload, 'pages', { parent: media.id, slug: 'press', title: 'Press kit' })
    const studio = await create(payload, 'pages', { slug: 'studio', title: 'Studio' })
    const podcast = await create(payload, 'pages', { parent: studio.id, slug: 'podcast', title: 'Podcast' })

    const { errors } = await payload.delete({
      collection: 'pages',
      overrideAccess: true,
      where: { id: { in: [media.id, studio.id] } }
    })

    expect(errors).toMatchObject([{ id: media.id }])
    expect(await readPath(payload, 'pages', press.id)).toBe('/media/press')
    expect(await findByPath({ path: '/studio', payload })).toBeNull()
    expect(await readPath(payload, 'pages', podcast.id)).toBe('/podcast')
  })

  // Payload runs the documents of a bulk operation at once, so each checks before another has written.
  it('saves one of two pages that a bulk update would put at the same path, and refuses the other', async () => {
    const { payload } = test
    const east = await create(payload, 'pages', { slug: 'east', title: 'East' })
    const west = await create(payload, 'pages', { slug: 'west', title: 'West' })
    const shelf = await create(payload, 'pages', { slug: 'shelf', title: 'Shelf' })
    const eastIntro = await create(payload, 'pages', { parent: east.id, slug: 'intro', title: 'East intro' })
    const westIntro = await create(payload, 'pages', { parent: west.id, slug: 'intro', title: 'West intro' })

    const { docs, errors } = await payload.update({
      collection: 'pages',
      data: { _status: 'published', parent: shelf.id },
      overrideAccess: true,
      where: { id: { in: [eastIntro.id, westIntro.id] } }
    })

    const [refused, saved] = errors[0]?.id === eastIntro.id ? [eastIntro, westIntro] : [westIntro, eastIntro]
    expect(errors).toMatchObject([{ id: refused.id }])
    expect(docs.map(({ id }) => id)).toEqual([saved.id])
    expect(await readPath(payload, 'pages', saved.id)).toBe('/shelf/intro')
    expect(await readPath(payload, 'pages', refused.id)).toBe(refused.path)
  })

  it('deletes one of two pages that a bulk delete would lift pages from to the same path, and refuses the other', async () => {
    const { payload } = test
    const north = await create(payload, 'pages', { slug: 'north', title: 'North' })
    const south = await create(payload, 'pages', { slug: 'south', title: 'South' })
    const northGuide = await create(payload, 'pages', { parent: north.id, slug: 'guide', title: 'North guide' })
    const southGuide = await create(payload, 'pages', { parent: south.id, slug: 'guide', title: 'South guide' })

    const { errors } = await payload.delete({
      collection: 'pages',
      overrideAccess: true,
      where: { id: { in: [north.id, south.id] } }
    })

    const [refused, deleted] =
      errors[0]?.id === north.id
        ? [{ below: northGuide, page: north }, { below: southGuide }]
        : [{ below: southGuide, page: south }, { below: northGuide }]
    expect(errors).toMatchObject([{ id: refused.page.id }])
    expect(await readPath(payload, 'pages', deleted.below.id)).toBe('/guide')
    expect(await readPath(payload, 'pages', refused.below.id)).toBe(refused.below.path)
    expect(await findByPath({ path: String(refused.page.path), payload })).toMatchObject({ document: { id: refused.page.id } })
  })

  // Payload runs the beforeDelete hooks of every document of a bulk delete before it deletes any, and
  // the lifts run one at a time, each from what the one before wrote.
  it('lifts a document to the top level when one bulk delete deletes its parent and the parent above that, and tells the site where it went', async () => {
    const { changes, payload } = test
    const port = await create(payload, 'pages', { slug: 'port', title: 'Port' })
    const quay = await create(payload, 'pages', { parent: port.id, slug: 'quay', title: 'Quay' })
    const crane = await create(payload, 'pages', { parent: quay.id, slug: 'crane', title: 'Crane' })
    changes.length = 0

    const { errors } = await payload.delete({
      collection: 'pages',
      overrideAccess: true,
      where: { id: { in: [port.id, quay.id] } }
    })

    const lifted = await readDocument(payload, 'pages', crane.id)
    // Each path the site was told the document went to, in the order it was told.
    const reportedTo = changes
      .flatMap((change) => change.lifted?.documents ?? [])
      .filter(({ id }) => String(id) === String(crane.id))
      .flatMap(({ paths }) => paths.map(({ to }) => to))
    const found = await findByPath({ path: '/crane', payload })
    expect({
      ancestors: lifted.ancestors,
      draftPath: await readPath(payload, 'pages', crane.id, { draft: true }),
      errors,
      foundAtPath: found ? String(found.document.id) : null,
      lastReportedTo: reportedTo.at(-1),
      parent: lifted.parent ?? null,
      path: lifted.path
    }).toEqual({
      ancestors: [],
      draftPath: '/crane',
      errors: [],
      foundAtPath: String(crane.id),
      lastReportedTo: '/crane',
      parent: null,
      path: '/crane'
    })
  })

  it('gives a document the parent one bulk update gives it, also when the same update moves the document above it', async () => {
    const { payload } = test
    const yard = await create(payload, 'pages', { slug: 'yard', title: 'Yard' })
    const dock = await create(payload, 'pages', { slug: 'dock', title: 'Dock' })
    const slip = await create(payload, 'pages', { parent: dock.id, slug: 'slip', title: 'Slip' })

    // One data object for both: the dock moves below the yard, and so does the slip, which leaves the dock.
    const { errors } = await payload.update({
      collection: 'pages',
      data: { _status: 'published', parent: yard.id },
      overrideAccess: true,
      where: { id: { in: [dock.id, slip.id] } }
    })

    expect(errors).toEqual([])
    expect(await readPath(payload, 'pages', dock.id)).toBe('/yard/dock')
    for (const draft of [false, true]) {
      const moved = await readDocument(payload, 'pages', slip.id, { draft })
      expect({ ancestors: moved.ancestors, parent: String(moved.parent), path: moved.path }).toEqual({
        ancestors: [yard.id],
        parent: String(yard.id),
        path: '/yard/slip'
      })
    }
  })
})

// The notes a site's own validation refuses, and the notes whose save waits until a refused note has
// taken its paths. A note's title is validated after the plugin's hook before the write, where a
// document of a bulk update takes its paths, so the validation of a refused note says when it has
// taken them. A save waits for at most a few seconds, so it never hangs where the refused note takes
// nothing or is never saved.
const refusedNotes = new Set<string>()
const waitingNotes = new Set<string>()
let markTaken = () => {}
let taken = Promise.resolve()

function resetNotes() {
  refusedNotes.clear()
  waitingNotes.clear()
  taken = new Promise<void>((resolve) => (markTaken = resolve))
}

const notes = (localized: boolean): CollectionConfig => ({
  slug: 'notes',
  admin: { useAsTitle: 'title' },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized,
      validate: (_value: unknown, { id }: { id?: number | string }) => {
        if (id === undefined || !refusedNotes.has(String(id))) return true
        markTaken()
        return 'The site refuses this note.'
      }
    }
  ],
  hooks: {
    beforeValidate: [
      async ({ originalDoc }) => {
        if (!waitingNotes.has(String(originalDoc?.id))) return
        await Promise.race([taken, new Promise((resolve) => setTimeout(resolve, 5_000))])
      }
    ]
  }
})

// An upload collection, which Payload gives each document of a bulk update a request of its own.
const files = (localized: boolean): CollectionConfig => ({
  slug: 'files',
  admin: { useAsTitle: 'title' },
  fields: [{ name: 'title', type: 'text', localized }],
  upload: { disableLocalStorage: true }
})

describeEachSetup(
  "with a site's own validation and an upload collection",
  {
    boot: (setup) => ({
      collections: [notes(setup.localized), files(setup.localized)],
      options: { collections: ['pages', 'posts', 'notices', 'notes', 'files'] }
    })
  },
  (test) => {
    beforeEach(resetNotes)

    // A stated limit: the document that takes the path first and is then refused for its own reason
    // keeps it taken for the rest of the bulk update.
    it('refuses the second of two documents that a bulk update would put at the same path, also when the first is refused for its own reason', async () => {
      const { payload } = test
      const east = await create(payload, 'notes', { slug: 'east', title: 'East' })
      const west = await create(payload, 'notes', { slug: 'west', title: 'West' })
      const rack = await create(payload, 'notes', { slug: 'rack', title: 'Rack' })
      const first = await create(payload, 'notes', { parent: east.id, slug: 'label', title: 'A label' })
      const second = await create(payload, 'notes', { parent: west.id, slug: 'label', title: 'B label' })
      refusedNotes.add(String(first.id))
      waitingNotes.add(String(second.id))

      const { errors } = await payload.update({
        collection: 'notes',
        data: { parent: rack.id },
        overrideAccess: true,
        where: { id: { in: [first.id, second.id] } }
      })

      // The first is refused for its title, and the second for the path the first took. A bulk update
      // lists each refusal by its ValidationError's message only.
      expect(errors.map(({ id, message }) => ({ id, message }))).toEqual(
        expect.arrayContaining([
          { id: first.id, message: 'The following field is invalid: Title' },
          { id: second.id, message: 'The following field is invalid: slug' }
        ])
      )
      expect(errors).toHaveLength(2)
      expect(await readPath(payload, 'notes', first.id)).toBe('/east/label')
      expect(await readPath(payload, 'notes', second.id)).toBe('/west/label')
    })

    it('saves one of two documents of an upload collection that a bulk update would put at the same path, and refuses the other', async () => {
      const { payload } = test
      const createFile = (data: Record<string, unknown>) =>
        payload.create({
          collection: 'files',
          data,
          file: { data: Buffer.from(String(data.slug)), mimetype: 'text/plain', name: `${String(data.slug)}.txt`, size: 4 },
          overrideAccess: true
        })
      const north = await createFile({ slug: 'north', title: 'North' })
      const south = await createFile({ slug: 'south', title: 'South' })
      const drawer = await createFile({ slug: 'drawer', title: 'Drawer' })
      const northMap = await createFile({ parent: north.id, slug: 'map', title: 'North map' })
      const southMap = await createFile({ parent: south.id, slug: 'map', title: 'South map' })

      const { errors } = await payload.update({
        collection: 'files',
        data: { parent: drawer.id },
        overrideAccess: true,
        where: { id: { in: [northMap.id, southMap.id] } }
      })

      const paths = [await readPath(payload, 'files', northMap.id), await readPath(payload, 'files', southMap.id)]
      expect({ atDrawerMap: paths.filter((path) => path === '/drawer/map').length, refused: errors.length }).toEqual({
        atDrawerMap: 1,
        refused: 1
      })
    })
  }
)

describeEachSetup(
  'with bulkOperationsSingleTransaction',
  { boot: { bulkOperationsSingleTransaction: true }, setups: SETUPS.filter(({ database }) => database === 'mongodb') },
  (test) => {
    it('refuses only the refused page of a bulk delete, and deletes the others', async () => {
      const { payload } = test
      await create(payload, 'pages', { slug: 'newsroom', title: 'Newsroom' })
      const archive = await create(payload, 'pages', { slug: 'archive', title: 'Archive' })
      const newsroom = await create(payload, 'pages', { parent: archive.id, slug: 'newsroom', title: 'Old newsroom' })
      const radio = await create(payload, 'pages', { slug: 'radio', title: 'Radio' })
      const show = await create(payload, 'pages', { parent: radio.id, slug: 'show', title: 'Show' })

      const { errors } = await payload.delete({
        collection: 'pages',
        overrideAccess: true,
        where: { id: { in: [archive.id, radio.id] } }
      })

      expect(errors).toMatchObject([{ id: archive.id }])
      expect(await readPath(payload, 'pages', newsroom.id)).toBe('/archive/newsroom')
      expect(await findByPath({ path: '/radio', payload })).toBeNull()
      expect(await readPath(payload, 'pages', show.id)).toBe('/show')
    })

    // Payload 4.0.0-beta.10 keeps the documents of a bulk update in the operation's transaction until
    // one fails, which rolls back the ones saved before it, so the refused page is sorted first.
    it('refuses only the refused page of a bulk update, and saves the pages after it', async () => {
      const { payload } = test
      const museum = await create(payload, 'pages', { slug: 'museum', title: 'Museum' })
      await create(payload, 'pages', { parent: museum.id, slug: 'armour', title: 'Armour hall' })
      const armour = await create(payload, 'pages', { slug: 'armour', title: 'Armour' })
      const coins = await create(payload, 'pages', { slug: 'coins', title: 'Coins' })

      const { errors } = await payload.update({
        collection: 'pages',
        data: { _status: 'published', parent: museum.id },
        overrideAccess: true,
        sort: 'title',
        where: { id: { in: [armour.id, coins.id] } }
      })

      expect(errors).toMatchObject([{ id: armour.id }])
      expect(await readPath(payload, 'pages', armour.id)).toBe('/armour')
      expect(await readPath(payload, 'pages', coins.id)).toBe('/museum/coins')
    })
  }
)
