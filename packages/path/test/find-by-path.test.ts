import { expect, expectTypeOf, it } from 'vitest'

import { findByPath, findPaths, type FoundByPath, type FoundPath } from '../src/index.js'
import { describeEachSetup } from './support/boot-payload.js'
import { create, update } from './support/documents.js'

describeEachSetup('', {}, (test, setup) => {
  // A path as findPaths gives it: with its locale with localization, and alone without.
  const at = (locale: string, path: string): FoundPath => (setup.localized ? { locale, path } : { path })
  // A save or a lookup in Swedish, which without localization is one of the one slug.
  const inSwedish = setup.localized ? { locale: 'sv' } : {}

  it('finds the document at a path in any collection, and says which', async () => {
    const { payload } = test
    const home = await create(payload, 'pages', { slug: 'home', title: 'Home' })
    const shop = await create(payload, 'pages', { slug: 'shop', title: 'Shop' })
    const sale = await create(payload, 'pages', { parent: shop.id, slug: 'sale', title: 'Sale' })
    const news = await create(payload, 'posts', { slug: 'news', title: 'News' })

    expect(await findByPath({ path: '/', payload })).toMatchObject({ collection: 'pages', document: { id: home.id } })
    expect(await findByPath({ path: '/news', payload })).toMatchObject({ collection: 'posts', document: { id: news.id } })
    expect(await findByPath({ path: '/shop/sale', payload })).toMatchObject({
      collection: 'pages',
      document: { id: sale.id, title: 'Sale' }
    })
    expect(await findByPath({ path: '/shop/nothing', payload })).toBeNull()
  })

  it('finds a document of a collection without drafts', async () => {
    const { payload } = test
    const closures = await create(payload, 'notices', { slug: 'closures', title: 'Closures' })
    const easter = await create(payload, 'notices', { parent: closures.id, slug: 'easter', title: 'Easter' })

    expect(await findByPath({ path: '/closures/easter', payload })).toMatchObject({
      collection: 'notices',
      document: { id: easter.id }
    })
  })

  it("gives the document's path in each locale it is published in when asked for its paths, and leaves them out otherwise", async () => {
    const { payload } = test
    const about = await create(payload, 'pages', { slug: 'about', title: 'About' })
    await update(payload, 'pages', about.id, { slug: 'om-oss', title: 'Om oss' }, inSwedish)

    const found = await findByPath({ ...inSwedish, collections: ['pages'], path: '/om-oss', paths: true, payload })
    expectTypeOf(found).toEqualTypeOf<(FoundByPath<'pages'> & { paths: FoundPath[] }) | null>()
    expect(found).toMatchObject({ collection: 'pages', document: { id: about.id } })
    expect(found?.paths).toEqual(setup.localized ? [at('en', '/about'), at('sv', '/om-oss')] : [at('en', '/om-oss')])
    expect(found?.paths).toEqual(await findPaths({ collection: 'pages', id: about.id, payload }))
    expect(await findByPath({ ...inSwedish, path: '/om-oss', payload })).not.toHaveProperty('paths')
  })

  it("gives the paths of the latest draft when asked for a draft's paths", async () => {
    const { payload } = test
    const plans = await create(payload, 'pages', { slug: 'plans', title: 'Plans' })
    await update(payload, 'pages', plans.id, { slug: 'pricing' }, { draft: true })

    const found = await findByPath({ draft: true, path: '/pricing', paths: true, payload })
    expect(found).toMatchObject({ document: { id: plans.id } })
    // The Swedish path takes the English slug it falls back to.
    expect(found?.paths).toEqual(setup.localized ? [at('en', '/pricing'), at('sv', '/pricing')] : [at('en', '/pricing')])
    expect(found?.paths).toEqual(await findPaths({ collection: 'pages', draft: true, id: plans.id, payload }))
    // The published document keeps its own path until the draft is published.
    expect(await findByPath({ path: '/plans', paths: true, payload })).toMatchObject({ paths: [at('en', '/plans')] })
  })
})

describeEachSetup('given pages and posts', { boot: { options: { collections: ['pages', 'posts'] } } }, (test) => {
  it('populates the relationships of the document to the depth asked for, and none without one', async () => {
    const { payload } = test
    const shop = await create(payload, 'pages', { slug: 'shop', title: 'Shop' })
    await create(payload, 'pages', { parent: shop.id, slug: 'sale', title: 'Sale' })

    expect(await findByPath({ path: '/shop/sale', payload })).toMatchObject({ document: { parent: shop.id } })
    expect(await findByPath({ depth: 1, path: '/shop/sale', payload })).toMatchObject({
      document: { parent: { id: shop.id, path: '/shop', title: 'Shop' } }
    })
  })

  it('looks in the collections it is asked for only, with a query for each, and says so in its type', async () => {
    const { payload } = test
    const tours = await create(payload, 'pages', { slug: 'tours', title: 'Tours' })
    const press = await create(payload, 'posts', { slug: 'press', title: 'Press' })

    const found = await findByPath({ collections: ['posts'], path: '/press', payload })
    expectTypeOf(found).toEqualTypeOf<FoundByPath<'posts'> | null>()
    expectTypeOf<FoundByPath<'posts'>['collection']>().toEqualTypeOf<'posts'>()
    expect(found).toMatchObject({ collection: 'posts', document: { id: press.id } })
    // A page's path finds nothing among the posts, with the one query.
    const queries = await test.countQueries(async () => {
      expect(await findByPath({ collections: ['posts'], path: '/tours', payload })).toBeNull()
    })
    expect(queries.map(({ collection }) => collection)).toEqual(['posts'])

    const inBoth = await findByPath({ collections: ['pages', 'posts'], path: '/tours', payload })
    expectTypeOf(inBoth).toEqualTypeOf<FoundByPath<'pages' | 'posts'> | null>()
    expect(inBoth).toMatchObject({ collection: 'pages', document: { id: tours.id } })
    expectTypeOf(await findByPath({ path: '/tours', payload })).toEqualTypeOf<FoundByPath | null>()
  })

  it('asks for collections the plugin was given', async () => {
    await expect(findByPath({ collections: ['posts', 'notices'], path: '/press', payload: test.payload })).rejects.toThrow(
      "@payloadpack/path was asked for collections that pathPlugin() wasn't given: notices."
    )
  })
})

describeEachSetup('without the plugin', { boot: { plugin: false } }, (test) => {
  it('asks for pathPlugin in the Payload config', async () => {
    await expect(findByPath({ path: '/', payload: test.payload })).rejects.toThrow(
      '@payloadpack/path: add pathPlugin() to the Payload config before calling findByPath, findPaths or backfillPaths'
    )
  })
})
