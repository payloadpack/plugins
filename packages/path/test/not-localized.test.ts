import type { CollectionConfig, CollectionSlug } from 'payload'
import { beforeEach, expect, it } from 'vitest'

import { backfillPaths, findByPath, type PathCollection } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, create, readPath, remove, store, update } from './support/documents.js'
import { listIndexes, readSqlitePlan } from './support/raw-access.js'
import { LOCALES, SETUPS } from './support/setups.js'

// A collection given with localized: false has one slug and one path, the same in every locale, in a
// site with localization. Pages stay localized, with a slug and a path per locale.

const inSwedish = { locale: 'sv' }

const inEveryLocale = <Value>(value: Value) => Object.fromEntries(LOCALES.map((locale) => [locale, value]))

const COLLECTIONS: CollectionConfig[] = [
  // Topics have a localized title, so Payload keeps a status per locale for them.
  titled('topics', true),
  // Products have no localized field, so Payload keeps one status for every locale.
  titled('products', false),
  // Sections get their parent from Payload's own hierarchy, and offers have none.
  { ...titled('sections', true), hierarchy: true },
  titled('offers', true),
  // Memos have no drafts, so every save publishes.
  { slug: 'memos', admin: { useAsTitle: 'title' }, fields: [{ name: 'title', type: 'text' }] },
  // Berths start below a path a topic can be at, so a berth can be where a document below that
  // topic would land while the topic's own path is free.
  titled('berths', false)
]

const GIVEN: PathCollection[] = [
  'pages',
  { basePath: '/topics', localized: false, slug: 'topics' },
  { basePath: '/products', localized: false, slug: 'products' },
  { basePath: '/sections', localized: false, slug: 'sections' },
  { localized: false, parent: false, slug: 'offers' },
  { basePath: '/memos', localized: false, slug: 'memos' },
  { basePath: '/topics/brygga', localized: false, slug: 'berths' }
]

describeEachSetup(
  'with collections that are not localized',
  {
    boot: { collections: COLLECTIONS, options: { collections: GIVEN } },
    setups: SETUPS.filter(({ localized }) => localized)
  },
  (test, setup) => {
    beforeEach(() => {
      test.changes.length = 0
    })

    // A document's path as each locale reads it.
    const readPaths = async (collection: CollectionSlug, id: Id, options: { draft?: boolean } = {}) =>
      Object.fromEntries(
        await Promise.all(
          LOCALES.map(async (locale) => [locale, await readPath(test.payload, collection, id, { ...options, locale })])
        )
      )
    // A document as the database holds it, where a localized value holds every locale.
    const readRow = (collection: CollectionSlug, id: Id) =>
      test.payload.db.findOne<{ [field: string]: unknown; id: Id }>({ collection, where: { id: { equals: id } } })
    // A document created in one locale, or in every locale at once.
    const createIn = (locale: string, collection: CollectionSlug, data: Record<string, unknown>) =>
      test.payload.create({ collection, data, locale, overrideAccess: true })
    const each = <Entry extends object>(entry: Entry) => LOCALES.map((locale) => ({ ...entry, locale }))

    it('gives a document one slug and one path, which a save in any locale sets for every locale', async () => {
      const { payload } = test
      const harbour = await create(payload, 'topics', { slug: 'harbour', title: 'Harbour' })
      const boats = await create(payload, 'topics', { parent: harbour.id, slug: 'boats', title: 'Boats' })

      const saved = await update(payload, 'topics', harbour.id, { slug: 'hamn', title: 'Hamn' }, inSwedish)

      expect(saved).toMatchObject({ path: '/topics/hamn', slug: 'hamn' })
      expect(await readPaths('topics', harbour.id)).toEqual(inEveryLocale('/topics/hamn'))
      expect(await readPaths('topics', boats.id)).toEqual(inEveryLocale('/topics/hamn/boats'))
      // The row holds the one slug and the one path, where a page's holds one per locale.
      expect(await readRow('topics', boats.id)).toMatchObject({ path: '/topics/hamn/boats', slug: 'boats' })
    })

    it('finds a document at its one path under each locale it is published in, and under no other', async () => {
      const { payload } = test
      const ferry = await create(payload, 'topics', { slug: 'ferry', title: 'Ferry' })
      const kettle = await create(payload, 'products', { slug: 'kettle', title: 'Kettle' })
      const findIn = (locale: string, path: string) => findByPath({ locale, path, payload })

      // A topic has a status per locale, and this one has none in Swedish yet.
      expect(await findIn('en', '/topics/ferry')).toMatchObject({ collection: 'topics', document: { id: ferry.id } })
      expect(await findIn('sv', '/topics/ferry')).toBeNull()

      await update(payload, 'topics', ferry.id, { title: 'Färja' }, inSwedish)
      expect(await findIn('sv', '/topics/ferry')).toMatchObject({ collection: 'topics', document: { id: ferry.id } })

      await payload.update({ collection: 'topics', data: { _status: 'draft' }, id: ferry.id, locale: 'sv', overrideAccess: true })

      expect(await findIn('sv', '/topics/ferry')).toBeNull()
      expect(await findIn('en', '/topics/ferry')).toMatchObject({ document: { id: ferry.id, title: 'Ferry' } })
      // A product has one status, so it is published in every locale at once.
      for (const locale of LOCALES) {
        expect(await findIn(locale, '/products/kettle')).toMatchObject({ collection: 'products', document: { id: kettle.id } })
      }
    })

    it("keeps a draft's new slug pending on a document published in one locale, until a publish in another moves it and its branch in every locale", async () => {
      const { changes, payload } = test
      const quay = await create(payload, 'topics', { slug: 'quay', title: 'Quay' })
      const cranes = await create(payload, 'topics', { parent: quay.id, slug: 'cranes', title: 'Cranes' })
      changes.length = 0

      await update(payload, 'topics', quay.id, { slug: 'kaj', title: 'Kaj' }, { draft: true, locale: 'sv' })

      expect(await readPaths('topics', quay.id)).toEqual(inEveryLocale('/topics/quay'))
      expect(await readPaths('topics', quay.id, { draft: true })).toEqual(inEveryLocale('/topics/kaj'))
      expect(await readPaths('topics', cranes.id)).toEqual(inEveryLocale('/topics/quay/cranes'))
      expect(changes).toEqual([])

      await update(payload, 'topics', quay.id, {}, inSwedish)

      expect(await readPaths('topics', quay.id)).toEqual(inEveryLocale('/topics/kaj'))
      expect(await readPaths('topics', cranes.id)).toEqual(inEveryLocale('/topics/kaj/cranes'))
    })

    it('moves a document that is published in no locale at once when a draft renames it, with the document below it', async () => {
      const { payload } = test
      const sketch = await create(payload, 'topics', { slug: 'sketch', title: 'Sketch' }, { draft: true })
      const margin = await create(payload, 'topics', { parent: sketch.id, slug: 'margin', title: 'Margin' }, { draft: true })

      await update(payload, 'topics', sketch.id, { slug: 'skiss' }, { draft: true, locale: 'sv' })

      expect(await readPaths('topics', sketch.id)).toEqual(inEveryLocale('/topics/skiss'))
      expect(await readPaths('topics', margin.id)).toEqual(inEveryLocale('/topics/skiss/margin'))
    })

    it('checks the branch of a pending move when a publish carries it out, not when the draft is saved', async () => {
      const { payload } = test
      const pier = await create(payload, 'topics', { slug: 'pier', title: 'Pier' })
      for (const slug of ['planks', 'ropes', 'nets']) await create(payload, 'topics', { parent: pier.id, slug, title: slug })
      // Where the topic's planks would land once it is at /topics/brygga.
      await create(payload, 'berths', { slug: 'planks', title: 'Planks berth' })

      await update(payload, 'topics', pier.id, { slug: 'brygga', title: 'Brygga' }, { draft: true, locale: 'sv' })

      expect(await catchFieldErrors(update(payload, 'topics', pier.id, {}, inSwedish))).toMatchObject([
        { message: 'Berth "Planks berth" is already at /topics/brygga/planks, so change the slug or the parent.', path: 'slug' }
      ])
      expect(await readPaths('topics', pier.id)).toEqual(inEveryLocale('/topics/pier'))
    })

    it('refuses a slug whose path a page is at in any one locale, and names that locale when the save is in another', async () => {
      const { payload } = test
      const section = await create(payload, 'pages', { slug: 'topics', title: 'Topics' })
      const crops = await create(payload, 'pages', { parent: section.id, slug: 'crops', title: 'Crops' })
      await update(payload, 'pages', crops.id, { slug: 'grodor', title: 'Grödor' }, inSwedish)
      await create(payload, 'pages', { parent: section.id, slug: 'weeds', title: 'Weeds' })
      const fields = await create(payload, 'topics', { slug: 'fields', title: 'Fields' })
      const refusal = (taken: string) => [{ message: `Page ${taken}, so change the slug or the parent.`, path: 'slug' }]

      expect(await catchFieldErrors(update(payload, 'topics', fields.id, { slug: 'crops' }, inSwedish))).toMatchObject(
        refusal('"Crops" is already at /topics/crops in en')
      )
      expect(await catchFieldErrors(update(payload, 'topics', fields.id, { slug: 'grodor' }, inSwedish))).toMatchObject(
        refusal('"Grödor" is already at this path')
      )
      expect(await catchFieldErrors(update(payload, 'topics', fields.id, { slug: 'grodor' }))).toMatchObject(
        refusal('"Grödor" is already at /topics/grodor in sv')
      )
      // Weeds has no Swedish slug, so it is at the path in both locales, and the save's own counts.
      expect(await catchFieldErrors(update(payload, 'topics', fields.id, { slug: 'weeds' }, inSwedish))).toMatchObject(
        refusal('"Weeds" is already at this path')
      )
      expect(await readPaths('topics', fields.id)).toEqual(inEveryLocale('/topics/fields'))
    })

    it('takes its one path in every locale, so a page is refused at it in any one of them', async () => {
      const { payload } = test
      const section = await create(payload, 'pages', { slug: 'products', title: 'Products' })
      const anchor = await create(payload, 'products', { slug: 'anchor', title: 'Anchor' })
      await update(payload, 'products', anchor.id, { slug: 'ankare' }, inSwedish)
      const chain = await create(payload, 'pages', { parent: section.id, slug: 'chain', title: 'Chain' })
      const refusal = (locale: string) => [
        { locale, message: 'Product "Anchor" is already at this path, so change the slug or the parent.', path: 'slug' }
      ]

      expect(await catchFieldErrors(update(payload, 'pages', chain.id, { slug: 'ankare' }))).toMatchObject(refusal('en'))
      expect(await catchFieldErrors(update(payload, 'pages', chain.id, { slug: 'ankare' }, inSwedish))).toMatchObject(
        refusal('sv')
      )
    })

    it('reports the path of a publish in each locale it publishes the document in', async () => {
      const { changes, payload } = test
      await create(payload, 'products', { slug: 'lamp', title: 'Lamp' })
      const reef = await create(payload, 'topics', { slug: 'reef', title: 'Reef' })
      await update(payload, 'topics', reef.id, { title: 'Rev' }, inSwedish)

      expect(changes).toEqual([
        { paths: each({ path: '/products/lamp' }) },
        { paths: [{ locale: 'en', path: '/topics/reef' }] },
        { paths: [{ locale: 'sv', path: '/topics/reef' }] }
      ])
    })

    it('reports where a move and a lift took each locale from and to, with the paths a site found the document at', async () => {
      const { changes, payload } = test
      const dune = await create(payload, 'topics', { slug: 'dune', title: 'Dune' })
      const grass = await create(payload, 'topics', { parent: dune.id, slug: 'grass', title: 'Grass' })
      changes.length = 0

      await update(payload, 'topics', dune.id, { slug: 'sanddyn' }, inSwedish)
      await remove(payload, 'topics', dune.id)

      const branch = { collection: 'topics', documentsBelow: 1, id: dune.id }
      expect(changes).toEqual([
        {
          moved: { ...branch, paths: each({ from: '/topics/dune', to: '/topics/sanddyn' }) },
          // The move published the topic in Swedish, and it left the path it was published at in English.
          paths: [...each({ path: '/topics/sanddyn' }), { locale: 'en', path: '/topics/dune' }]
        },
        {
          lifted: { ...branch, paths: each({ from: '/topics/sanddyn', to: '/topics' }) },
          paths: each({ path: '/topics/sanddyn' })
        }
      ])
      expect(await readPaths('topics', grass.id)).toEqual(inEveryLocale('/topics/grass'))
    })

    it('gives the documents a site already had their one path, and keeps a pending move pending', async () => {
      const { payload } = test
      // Products hold no localized field, so their rows are those of a site without localization.
      const rows = { ...setup, localized: false }
      const tools = await store(test, rows, 'products', { slug: 'tools', title: 'Tools' })
      const saws = await store(
        test,
        rows,
        'products',
        { parent: tools, slug: 'saws', title: 'Saws' },
        { parent: tools, slug: 'handsaws', title: 'Handsaws' }
      )

      const report = await backfillPaths({ collections: ['products'], payload })

      expect(report).toMatchObject({ left: [], updated: 2 })
      expect(await readPaths('products', saws)).toEqual(inEveryLocale('/products/tools/saws'))
      expect(await readPaths('products', saws, { draft: true })).toEqual(inEveryLocale('/products/tools/handsaws'))
      expect(await readRow('products', saws)).toMatchObject({ ancestors: [tools], path: '/products/tools/saws' })
    })

    it('gives a duplicate the one slug with -copy, or -copy-2 when that is in use', async () => {
      const { payload } = test
      const atlas = await create(payload, 'topics', { slug: 'atlas', title: 'Atlas' })
      const duplicate = () => payload.duplicate({ collection: 'topics', draft: true, id: atlas.id, overrideAccess: true })

      const copies = [await duplicate(), await duplicate()]

      expect(await Promise.all(copies.map(({ id }) => readRow('topics', id)))).toMatchObject([
        { path: '/topics/atlas-copy', slug: 'atlas-copy' },
        { path: '/topics/atlas-copy-2', slug: 'atlas-copy-2' }
      ])
    })

    it('takes the one slug of a save in every locale at once, and moves the branch in every locale', async () => {
      const { payload } = test
      const lock = await create(payload, 'topics', { slug: 'lock', title: 'Lock' })
      const gates = await create(payload, 'topics', { parent: lock.id, slug: 'gates', title: 'Gates' })

      const saved = await update(
        payload,
        'topics',
        lock.id,
        { slug: 'Sluice', title: { en: 'Sluice', sv: 'Sluss' } },
        { locale: 'all' }
      )

      expect(saved).toMatchObject({ path: '/topics/sluice', slug: 'sluice' })
      expect(await readPaths('topics', gates.id)).toEqual(inEveryLocale('/topics/sluice/gates'))
    })

    it('makes the one slug from the title of the locale a save is in, and of the default locale in a save of every locale at once', async () => {
      const published = { _status: 'published' }
      const swedish = await createIn('sv', 'topics', { ...published, title: 'Östra hamnen' })
      const both = await createIn('all', 'topics', { ...published, title: { en: 'West harbour', sv: 'Västra hamnen' } })
      const plain = await createIn('all', 'products', { ...published, title: 'Storm lantern' })

      expect(await readPaths('topics', swedish.id)).toEqual(inEveryLocale('/topics/ostra-hamnen'))
      expect(both).toMatchObject({ path: '/topics/west-harbour', slug: 'west-harbour' })
      expect(plain).toMatchObject({ path: '/products/storm-lantern', slug: 'storm-lantern' })
    })

    it('gives a document of a collection without a parent its one path, and neither a parent nor ancestors', async () => {
      const { payload } = test
      const sale = await create(payload, 'offers', { slug: 'sale', title: 'Sale' })

      await update(payload, 'offers', sale.id, { slug: 'rea', title: 'Rea' }, inSwedish)

      expect(await readPaths('offers', sale.id)).toEqual(inEveryLocale('/rea'))
      const row = await readRow('offers', sale.id)
      expect(row).toMatchObject({ path: '/rea', slug: 'rea' })
      expect(row).not.toHaveProperty('ancestors')
    })

    it("moves a document and the one below it in every locale, below the parent of Payload's hierarchy", async () => {
      const { payload } = test
      const wing = await create(payload, 'sections', { slug: 'wing', title: 'Wing' })
      const annex = await create(payload, 'sections', { slug: 'annex', title: 'Annex' })
      const stairs = await create(payload, 'sections', { _h_sections: annex.id, slug: 'stairs', title: 'Stairs' })

      await update(payload, 'sections', annex.id, { _h_sections: wing.id, slug: 'annexet' }, inSwedish)

      expect(await readPaths('sections', stairs.id)).toEqual(inEveryLocale('/sections/wing/annexet/stairs'))
      expect(await readRow('sections', stairs.id)).toMatchObject({
        ancestors: [wing.id, annex.id],
        path: '/sections/wing/annexet/stairs'
      })
    })

    it('gives a document of a collection without drafts its one path in every locale, from its first save in one', async () => {
      const { changes, payload } = test
      const closing = await createIn('sv', 'memos', { slug: 'closing', title: 'Closing' })
      // A save publishes it in every locale, where a site finds it at once.
      expect(changes).toEqual([{ paths: each({ path: '/memos/closing' }) }])
      const hours = await createIn('en', 'memos', { parent: closing.id, slug: 'hours', title: 'Hours' })
      for (const locale of LOCALES) {
        expect(await findByPath({ locale, path: '/memos/closing/hours', payload })).toMatchObject({
          collection: 'memos',
          document: { id: hours.id }
        })
      }

      await update(payload, 'memos', closing.id, { slug: 'stangt' }, inSwedish)

      expect(await readPaths('memos', hours.id)).toEqual(inEveryLocale('/memos/stangt/hours'))
    })

    it('finds a path with one query per collection, on the index of the one path', async () => {
      const { payload } = test
      const collections: CollectionSlug[] = ['topics', 'products']
      for (const collection of collections) {
        expect(await listIndexes(test, setup, collection)).toContain(`${collection}(path)`)
      }

      const lookup = await test.countQueries(() => findByPath({ collections, locale: 'sv', path: '/topics/nothing', payload }))

      expect(lookup.map(({ collection }) => collection)).toEqual(collections)
      // SQLite picks an index by the query alone, so its plan shows the one the lookup reads.
      if (setup.database === 'sqlite') {
        for (const query of lookup) {
          expect(await readSqlitePlan(test, query)).toContainEqual(
            expect.stringContaining(`USING INDEX ${query.collection}_path_idx`)
          )
        }
      }
    })
  }
)

describeEachSetup(
  'with a collection given with localized: false in a site without localization',
  {
    boot: {
      collections: [titled('topics', false)],
      options: { collections: ['pages', { basePath: '/topics', localized: false, slug: 'topics' }] }
    },
    setups: SETUPS.filter(({ localized }) => !localized)
  },
  (test) => {
    it('changes nothing: a path has no locale, and a move reports none', async () => {
      const { changes, payload } = test
      const quarry = await create(payload, 'topics', { slug: 'quarry', title: 'Quarry' })
      const gravel = await create(payload, 'topics', { parent: quarry.id, slug: 'gravel', title: 'Gravel' })
      changes.length = 0

      await update(payload, 'topics', quarry.id, { slug: 'pit' })

      expect(await readPath(payload, 'topics', gravel.id)).toBe('/topics/pit/gravel')
      expect(await findByPath({ path: '/topics/pit', payload })).toMatchObject({ document: { id: quarry.id } })
      expect(changes).toEqual([
        {
          moved: {
            collection: 'topics',
            documentsBelow: 1,
            id: quarry.id,
            paths: [{ from: '/topics/quarry', to: '/topics/pit' }]
          },
          paths: [{ path: '/topics/pit' }, { path: '/topics/quarry' }]
        }
      ])
    })
  }
)
