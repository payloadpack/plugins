import { beforeEach, expect, it } from 'vitest'

import { backfillPaths, findByPath } from '../src/index.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, remove, store, update } from './support/documents.js'

describeEachSetup(
  '',
  {
    boot: (setup) => ({
      // Articles have no parent below a base path, and landings none at the root. Topics have none
      // in their paths, while Payload's own hierarchy still gives each one a parent in its tree.
      collections: [
        titled('articles', setup.localized),
        titled('landings', setup.localized),
        { ...titled('topics', setup.localized), hierarchy: true }
      ],
      options: {
        collections: [
          'pages',
          { basePath: '/news', parent: false, slug: 'articles' },
          { parent: false, slug: 'landings' },
          { basePath: '/topics', parent: false, slug: 'topics' }
        ]
      }
    })
  },
  (test, setup) => {
    beforeEach(() => {
      test.changes.length = 0
    })

    // Without localization a changed path has no locale; with it, the locale it belongs to.
    const at = (path: string) => (setup.localized ? { locale: 'en', path } : { path })
    // Where a document went. With localization Swedish falls back to the English slug, so it went there too.
    const fromTo = (from: string, to: string) =>
      setup.localized ? ['en', 'sv'].map((locale) => ({ from, locale, to })) : [{ from, to }]

    it('puts a document at the base path, a slash and its slug, whatever parent a save sends', async () => {
      const { payload } = test
      const budget = await create(payload, 'articles', { slug: 'budget', title: 'Budget' })
      const rates = await create(payload, 'articles', { parent: budget.id, slug: 'rates', title: 'Rates' })

      await update(payload, 'articles', rates.id, { parent: budget.id, title: 'Interest rates' })

      expect(await readPath(payload, 'articles', budget.id)).toBe('/news/budget')
      const stored = await readDocument(payload, 'articles', rates.id)
      expect(stored).toMatchObject({ path: '/news/rates', title: 'Interest rates' })
      expect(stored).not.toHaveProperty('parent')
      expect(stored).not.toHaveProperty('ancestors')
      expect(await findByPath({ path: '/news/rates', payload })).toMatchObject({
        collection: 'articles',
        document: { id: rates.id }
      })
    })

    it('makes the document that takes the root slug the home page at /, in a collection without a base path', async () => {
      const { payload } = test
      const sale = await create(payload, 'landings', { slug: 'sale', title: 'Sale' })
      const welcome = await create(payload, 'landings', { slug: 'welcome', title: 'Welcome' })

      await update(payload, 'landings', welcome.id, { slug: 'home' })

      expect(await readPath(payload, 'landings', sale.id)).toBe('/sale')
      expect(await readPath(payload, 'landings', welcome.id)).toBe('/')
    })

    it('moves a renamed document, in its latest version too, and reports the move', async () => {
      const { changes, payload } = test
      const strike = await create(payload, 'articles', { slug: 'strike', title: 'Strike' })
      changes.length = 0

      await update(payload, 'articles', strike.id, { slug: 'walkout' })

      expect(await readPath(payload, 'articles', strike.id)).toBe('/news/walkout')
      expect(await readPath(payload, 'articles', strike.id, { draft: true })).toBe('/news/walkout')
      expect(changes).toEqual([
        {
          moved: {
            collection: 'articles',
            documents: [],
            documentsBelow: 0,
            id: strike.id,
            paths: fromTo('/news/strike', '/news/walkout')
          },
          paths: [at('/news/walkout'), at('/news/strike')]
        }
      ])
    })

    it('refuses a path a document of a collection with parents is at, and the other way round', async () => {
      const { payload } = test
      const news = await create(payload, 'pages', { slug: 'news', title: 'News' })
      await create(payload, 'pages', { parent: news.id, slug: 'floods', title: 'Floods' })
      await create(payload, 'articles', { slug: 'drought', title: 'Drought' })

      expect(await catchFieldErrors(create(payload, 'articles', { slug: 'floods', title: 'Floods article' }))).toMatchObject([
        { message: 'Page "Floods" is already at this path, so change the slug or the parent.', path: 'slug' }
      ])
      expect(
        await catchFieldErrors(create(payload, 'pages', { parent: news.id, slug: 'drought', title: 'Drought page' }))
      ).toMatchObject([{ message: 'Article "Drought" is already at this path, so change the slug or the parent.', path: 'slug' }])
    })

    it('deletes a document and reports its path', async () => {
      const { changes, payload } = test
      const recall = await create(payload, 'articles', { slug: 'recall', title: 'Recall' })
      changes.length = 0

      await remove(payload, 'articles', recall.id)

      expect(changes).toEqual([{ paths: [at('/news/recall')] }])
      expect(await findByPath({ path: '/news/recall', payload })).toBeNull()
    })

    it('gives a duplicate the slug with -copy, or -copy-2 when that is in use', async () => {
      const { payload } = test
      const ballot = await create(payload, 'articles', { slug: 'ballot', title: 'Ballot' })
      const duplicate = () => payload.duplicate({ collection: 'articles', draft: true, id: ballot.id, overrideAccess: true })

      const copies = [await duplicate(), await duplicate()]

      expect(copies.map(({ path }) => path)).toEqual(['/news/ballot-copy', '/news/ballot-copy-2'])
    })

    it('gives the documents a site already had their paths', async () => {
      const { payload } = test
      const census = await store(test, setup, 'articles', { slug: 'census', title: 'Census' })
      const survey = await store(test, setup, 'articles', { slug: 'survey', title: 'Survey' }, { slug: 'poll', title: 'Poll' })

      const report = await backfillPaths({ collections: ['articles'], payload })

      expect(report).toMatchObject({ left: [], updated: 2 })
      expect(await readPath(payload, 'articles', census)).toBe('/news/census')
      expect(await readPath(payload, 'articles', survey)).toBe('/news/survey')
      expect(await readPath(payload, 'articles', survey, { draft: true })).toBe('/news/poll')
    })

    it("keeps the parent out of a path in a collection with Payload's hierarchy, where a document still has one", async () => {
      const { payload } = test
      const science = await create(payload, 'topics', { slug: 'science', title: 'Science' })
      const physics = await create(payload, 'topics', { _h_topics: science.id, slug: 'physics', title: 'Physics' })

      const stored = await readDocument(payload, 'topics', physics.id)
      expect(stored.path).toBe('/topics/physics')
      expect(String(stored._h_topics)).toBe(String(science.id))
      expect(stored).not.toHaveProperty('ancestors')
    })
  }
)
