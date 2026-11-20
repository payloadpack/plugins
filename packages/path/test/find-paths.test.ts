import { expect, it } from 'vitest'

import { findByPath, findPaths, type FoundPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { create, remove, update } from './support/documents.js'

// Pages and articles are localized in a localized setup, and notices have no drafts.
describeEachSetup(
  'finding the paths of one document',
  {
    boot: (setup) => ({
      collections: [titled('topics', setup.localized), { ...titled('articles', setup.localized), trash: true }],
      notLocalized: ['topics'],
      options: { collections: ['pages', 'notices', 'topics', 'articles'] }
    })
  },
  (test, setup) => {
    // A path as findPaths gives it: with its locale with localization, and alone without.
    const at = (locale: string, path: string): FoundPath => (setup.localized ? { locale, path } : { path })
    // A save in Swedish, which without localization is a save of the one slug.
    const inSwedish = setup.localized ? { locale: 'sv' } : {}

    async function expectFoundAt(found: FoundPath[], id: Id, { draft = false } = {}) {
      for (const { locale, path } of found) {
        expect(await findByPath({ draft, locale, path, payload: test.payload })).toMatchObject({ document: { id } })
      }
    }

    it('gives the path of each locale a page is published in, with the Swedish one once it is published in Swedish', async () => {
      const { payload } = test
      const about = await create(payload, 'pages', { slug: 'about', title: 'About' })

      expect(await findPaths({ collection: 'pages', id: about.id, payload })).toEqual([at('en', '/about')])

      await update(payload, 'pages', about.id, { slug: 'om-oss', title: 'Om oss' }, inSwedish)

      const found = await findPaths({ collection: 'pages', id: about.id, payload })
      expect(found).toEqual(setup.localized ? [at('en', '/about'), at('sv', '/om-oss')] : [at('en', '/om-oss')])
      await expectFoundAt(found, about.id)
    })

    it('gives the one path of a collection with one path in every locale once for each locale it is published in', async () => {
      const { payload } = test
      const harbour = await create(payload, 'topics', { slug: 'harbour', title: 'Harbour' })

      expect(await findPaths({ collection: 'topics', id: harbour.id, payload })).toEqual([at('en', '/harbour')])

      await update(payload, 'topics', harbour.id, { title: 'Hamn' }, inSwedish)

      const found = await findPaths({ collection: 'topics', id: harbour.id, payload })
      expect(found).toEqual(setup.localized ? [at('en', '/harbour'), at('sv', '/harbour')] : [at('en', '/harbour')])
      await expectFoundAt(found, harbour.id)
    })

    it("gives a draft's pending rename with draft only, in every locale", async () => {
      const { payload } = test
      const plans = await create(payload, 'pages', { slug: 'plans', title: 'Plans' })

      await update(payload, 'pages', plans.id, { slug: 'pricing' }, { draft: true })

      expect(await findPaths({ collection: 'pages', id: plans.id, payload })).toEqual([at('en', '/plans')])
      const drafted = await findPaths({ collection: 'pages', draft: true, id: plans.id, payload })
      // The Swedish path takes the English slug it falls back to.
      expect(drafted).toEqual(setup.localized ? [at('en', '/pricing'), at('sv', '/pricing')] : [at('en', '/pricing')])
      await expectFoundAt(drafted, plans.id, { draft: true })
    })

    it('gives no path of a document that was never published, and its draft paths with draft', async () => {
      const { payload } = test
      const sketch = await create(payload, 'pages', { slug: 'sketch', title: 'Sketch' }, { draft: true })

      expect(await findPaths({ collection: 'pages', id: sketch.id, payload })).toEqual([])
      expect(await findPaths({ collection: 'pages', draft: true, id: sketch.id, payload })).toEqual(
        setup.localized ? [at('en', '/sketch'), at('sv', '/sketch')] : [at('en', '/sketch')]
      )
    })

    it('gives no path of a document in the trash, with draft or without', async () => {
      const { payload } = test
      const recall = await create(payload, 'articles', { slug: 'recall', title: 'Recall' })
      await payload.update({
        collection: 'articles',
        data: { deletedAt: new Date().toISOString() },
        id: recall.id,
        overrideAccess: true
      })

      expect(await findPaths({ collection: 'articles', id: recall.id, payload })).toEqual([])
      expect(await findPaths({ collection: 'articles', draft: true, id: recall.id, payload })).toEqual([])
    })

    it('gives no path of a document that no longer exists', async () => {
      const { payload } = test
      const gone = await create(payload, 'pages', { slug: 'gone', title: 'Gone' })
      await remove(payload, 'pages', gone.id)

      expect(await findPaths({ collection: 'pages', id: gone.id, payload })).toEqual([])
      expect(await findPaths({ collection: 'pages', draft: true, id: gone.id, payload })).toEqual([])
    })

    it('asks for a collection the plugin was given', async () => {
      const { payload } = test
      const press = await create(payload, 'posts', { slug: 'press', title: 'Press' })

      await expect(findPaths({ collection: 'posts', id: press.id, payload })).rejects.toThrow(
        "@payloadpack/path was asked for collections that pathPlugin() wasn't given: posts."
      )
    })

    it('gives the path of each locale a document without drafts was saved in, with draft too', async () => {
      const { payload } = test
      const closures = await create(payload, 'notices', { slug: 'closures', title: 'Closures' })

      // Without drafts, a locale has no path until the document is saved in it.
      expect(await findPaths({ collection: 'notices', id: closures.id, payload })).toEqual([at('en', '/closures')])

      await update(payload, 'notices', closures.id, { title: 'Stängt' }, inSwedish)

      const found = await findPaths({ collection: 'notices', id: closures.id, payload })
      expect(found).toEqual(setup.localized ? [at('en', '/closures'), at('sv', '/closures')] : [at('en', '/closures')])
      expect(await findPaths({ collection: 'notices', draft: true, id: closures.id, payload })).toEqual(found)
      await expectFoundAt(found, closures.id)
    })
  }
)
