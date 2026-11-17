import type { CollectionConfig } from 'payload'
import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, remove, update } from './support/documents.js'

describeEachSetup('', {}, (test, setup) => {
  it("stores the parent's path, a slash and the slug, and the ids of the documents above, in each collection", async () => {
    const { payload } = test
    const guides = await create(payload, 'pages', { slug: 'guides', title: 'Guides' })
    const install = await create(payload, 'pages', { parent: guides.id, slug: 'install', title: 'Install' })
    const setup = await create(payload, 'pages', { parent: install.id, slug: 'setup', title: 'Setup' })
    const series = await create(payload, 'posts', { slug: 'series', title: 'Series' })
    const part = await create(payload, 'posts', { parent: series.id, slug: 'part-one', title: 'Part one' })

    expect(await readPath(payload, 'pages', guides.id)).toBe('/guides')
    expect(await readPath(payload, 'pages', install.id)).toBe('/guides/install')
    expect(await readPath(payload, 'pages', setup.id)).toBe('/guides/install/setup')
    expect(await readPath(payload, 'posts', part.id)).toBe('/series/part-one')
    expect((await readDocument(payload, 'pages', setup.id)).ancestors).toEqual([guides.id, install.id])
    expect((await readDocument(payload, 'posts', part.id)).ancestors).toEqual([series.id])
    expect((await readDocument(payload, 'pages', guides.id)).ancestors).toEqual([])
  })

  it('gives a document of a collection without drafts its path and ancestors when it is created', async () => {
    const { payload } = test
    const timetable = await create(payload, 'notices', { slug: 'timetable', title: 'Timetable' })
    const weekend = await create(payload, 'notices', { parent: timetable.id, slug: 'weekend', title: 'Weekend' })

    expect(weekend.path).toBe('/timetable/weekend')
    expect(await readPath(payload, 'notices', weekend.id)).toBe('/timetable/weekend')
    expect((await readDocument(payload, 'notices', weekend.id)).ancestors).toEqual([timetable.id])
  })

  it('keeps the path and ancestors it made when a save sends its own, as a stale admin form does', async () => {
    const { payload } = test
    const cellar = await create(payload, 'posts', { slug: 'cellar', title: 'Cellar' })
    const jam = await create(payload, 'posts', { parent: cellar.id, slug: 'jam', title: 'Jam' })
    const sent = { ancestors: ['1234'], path: '/admin' }

    await update(payload, 'posts', jam.id, { ...sent, title: 'Strawberry jam' })
    await update(payload, 'posts', jam.id, { ...sent, title: 'Plum jam' }, { autosave: true, draft: true })
    const created = await create(payload, 'posts', { ...sent, parent: cellar.id, slug: 'marmalade', title: 'Marmalade' })

    for (const [id, draft] of [
      [jam.id, false],
      [jam.id, true],
      [created.id, false]
    ] as const) {
      const document = await readDocument(payload, 'posts', id, { draft })
      expect([document.path, document.ancestors]).toEqual([id === jam.id ? '/cellar/jam' : '/cellar/marmalade', [cellar.id]])
    }
  })

  it('returns the saved document with the path it was saved at, as a draft too', async () => {
    const { payload } = test
    const pantry = await create(payload, 'pages', { slug: 'pantry', title: 'Pantry' })

    expect(pantry.path).toBe('/pantry')
    expect((await update(payload, 'pages', pantry.id, { slug: 'larder' }, { draft: true })).path).toBe('/larder')
    expect((await update(payload, 'pages', pantry.id, { slug: 'store-room' })).path).toBe('/store-room')
  })

  it('returns the ancestors to a read as any other field, and finds the documents below a document by them', async () => {
    const { payload } = test
    const wing = await create(payload, 'pages', { slug: 'wing', title: 'Wing' })
    const ward = await create(payload, 'pages', { parent: wing.id, slug: 'ward', title: 'Ward' })
    const bed = await create(payload, 'pages', { parent: ward.id, slug: 'bed', title: 'Bed' })
    // As a signed-in editor reads: with the collection's access, so without a hidden field.
    const asEditor = { overrideAccess: false, user: { id: 'editor', collection: 'users' } } as const

    const read = await payload.findByID({ collection: 'pages', depth: 0, id: bed.id, ...asEditor })
    const below = await payload.find({ collection: 'pages', depth: 0, where: { ancestors: { equals: wing.id } }, ...asEditor })

    expect(read.ancestors).toEqual([wing.id, ward.id])
    expect(below.docs.map(({ id }) => id).sort()).toEqual([ward.id, bed.id].sort())
  })

  it('makes the slug of a new document from its title', async () => {
    const { payload } = test
    const fromTitle = await create(payload, 'pages', { title: 'Opening Hours' })

    expect(await readPath(payload, 'pages', fromTitle.id)).toBe('/opening-hours')
  })

  it('cleans a sent slug', async () => {
    const { payload } = test
    const cleaned = await create(payload, 'pages', { slug: 'Summer Sale!', title: 'Sale' })

    expect((await readDocument(payload, 'pages', cleaned.id)).slug).toBe('summer-sale')
    expect(await readPath(payload, 'pages', cleaned.id)).toBe('/summer-sale')
  })

  it('keeps the slug when a save clears it', async () => {
    const { payload } = test
    const kept = await create(payload, 'pages', { slug: 'winter-sale', title: 'Sale' })
    const saved = await update(payload, 'pages', kept.id, { slug: '', title: 'Winter sale' })

    expect((await readDocument(payload, 'pages', kept.id)).slug).toBe('winter-sale')
    expect(saved.path).toBe('/winter-sale')
  })

  it('takes the accents off Latin letters in a slug and keeps the letters of other scripts', async () => {
    const { payload } = test
    const posts = []
    for (const data of [
      { title: 'Vår historia' },
      { slug: 'Över oss', title: 'About us' },
      { title: 'Smørrebrød Straße' },
      { title: 'Новости' }
    ]) {
      posts.push(await create(payload, 'posts', data))
    }

    expect(posts.map(({ slug }) => slug)).toEqual(['var-historia', 'over-oss', 'smorrebrod-strasse', 'новости'])
    expect(await findByPath({ path: '/новости', payload })).toMatchObject({ document: { id: posts[3]!.id } })
  })

  it('refuses a new document with neither a slug nor a title', async () => {
    expect(await catchFieldErrors(create(test.payload, 'posts', {}))).toMatchObject([
      { message: 'Give this document a slug, or a title to make one from.', path: 'slug' }
    ])
  })

  it("refuses a parent that doesn't exist", async () => {
    const { payload } = test
    const gone = await create(payload, 'posts', { slug: 'gone', title: 'Gone' })
    await remove(payload, 'posts', gone.id)

    expect(
      await catchFieldErrors(create(payload, 'posts', { parent: gone.id, slug: 'left-behind', title: 'Left behind' }))
    ).toMatchObject([{ message: "The parent doesn't exist, so pick another one.", path: 'parent' }])
  })

  it('refuses a parent that has no path yet, until the parent is saved', async () => {
    const { payload } = test
    // Stored as the documents are that a collection held before the plugin was added to it.
    const almanac = await payload.db.create({
      collection: 'posts',
      data: { title: setup.localized ? { en: 'Almanac' } : 'Almanac' }
    })
    const january = { parent: almanac.id, slug: 'january', title: 'January' }

    expect(await catchFieldErrors(create(payload, 'posts', january))).toMatchObject([
      { message: 'The parent has no path yet, so save the parent first.', path: 'parent' }
    ])

    await update(payload, 'posts', almanac.id, { slug: 'almanac' })
    expect((await create(payload, 'posts', january)).path).toBe('/almanac/january')
  })

  it('refuses a document as its own parent or below itself', async () => {
    const { payload } = test
    const shelf = await create(payload, 'posts', { slug: 'shelf', title: 'Shelf' })
    const box = await create(payload, 'posts', { parent: shelf.id, slug: 'box', title: 'Box' })
    const refusal = [{ message: "A document can't sit below itself, so pick another parent.", path: 'parent' }]

    expect(await catchFieldErrors(update(payload, 'posts', shelf.id, { parent: shelf.id }))).toMatchObject(refusal)
    expect(await catchFieldErrors(update(payload, 'posts', shelf.id, { parent: box.id }))).toMatchObject(refusal)
  })
})

// A collection whose own hook saves another document of it on the same request, as a site's hook may.
const events = (localized: boolean): CollectionConfig => ({
  ...titled('events', localized),
  hooks: {
    beforeChange: [
      async ({ data, operation, req }) => {
        if (operation === 'create' && data.title === 'Launch') {
          await req.payload.create({
            collection: 'events',
            data: { _status: 'published', slug: `${data.slug}-party`, title: 'Launch party' },
            overrideAccess: true,
            req
          })
        }
        return data
      }
    ]
  }
})

// A collection whose own hook returns an object of its own, as a site's hook may: a copy of the data
// made with a spread, or one rebuilt from its entries, whichever the save's context asks for.
const stalls = (localized: boolean): CollectionConfig => ({
  ...titled('stalls', localized),
  hooks: {
    beforeChange: [
      ({ context, data }) => {
        if (context.returns === 'a spread copy') return { ...data }
        if (context.returns === 'a rebuilt object') return Object.fromEntries(Object.entries(data))
        return data
      }
    ]
  }
})

const SPREAD_COPY = { returns: 'a spread copy' }
const REBUILT_OBJECT = { returns: 'a rebuilt object' }

// The block's database holds no pages or posts but its tests' own, so on Postgres and SQLite no post
// shares the id of a page a test creates.
describeEachSetup(
  "with a site's own hooks",
  {
    boot: (setup) => ({
      collections: [events(setup.localized), stalls(setup.localized)],
      options: { collections: ['pages', 'posts', 'events', 'stalls'] }
    })
  },
  (test) => {
    it('refuses a page as the parent of a post, because a post sits below a post', async () => {
      const { payload } = test
      const page = await create(payload, 'pages', { slug: 'news', title: 'News' })

      expect(
        await catchFieldErrors(create(payload, 'posts', { parent: page.id, slug: 'press-release', title: 'Press release' }))
      ).toMatchObject([{ message: "The parent doesn't exist, so pick another one.", path: 'parent' }])
    })

    it('checks and places each document a hook saves on the same request on its own', async () => {
      const { payload } = test
      const launch = await create(payload, 'events', { slug: 'launch', title: 'Launch' })

      expect(launch.path).toBe('/launch')
      expect(await findByPath({ path: '/launch', payload })).toMatchObject({ document: { id: launch.id } })
      expect(await findByPath({ path: '/launch-party', payload })).toMatchObject({ document: { title: 'Launch party' } })
      expect(await catchFieldErrors(create(payload, 'events', { slug: 'admin', title: 'Launch' }))).toMatchObject([
        { message: 'The site serves the CMS at /admin, so pick another slug or a parent.', path: 'slug' }
      ])
    })

    it('places a document whose own hook returns a copy of the data made with a spread', async () => {
      const { payload } = test
      const saved = { collection: 'stalls', context: SPREAD_COPY, overrideAccess: true } as const
      const market = await payload.create({ ...saved, data: { _status: 'published', slug: 'market', title: 'Market' } })
      const fruit = await payload.create({
        ...saved,
        data: { _status: 'published', parent: market.id, slug: 'fruit', title: 'Fruit' }
      })

      await payload.update({ ...saved, data: { _status: 'published', slug: 'bazaar' }, id: market.id })

      expect(await readPath(payload, 'stalls', fruit.id)).toBe('/bazaar/fruit')
    })

    it('places a new and a stored document whose own hook returns an object it rebuilt', async () => {
      const { payload } = test
      const saved = { collection: 'stalls', context: REBUILT_OBJECT, overrideAccess: true } as const
      const fair = await payload.create({ ...saved, data: { _status: 'published', slug: 'fair', title: 'Fair' } })
      const honey = await create(payload, 'stalls', { parent: fair.id, slug: 'honey', title: 'Honey' })

      await payload.update({ ...saved, data: { _status: 'published', slug: 'fete' }, id: fair.id })

      expect(fair.path).toBe('/fair')
      expect(await readPath(payload, 'stalls', fair.id)).toBe('/fete')
      expect(await readPath(payload, 'stalls', honey.id)).toBe('/fete/honey')
    })
  }
)
