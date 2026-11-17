import { expect, expectTypeOf, it } from 'vitest'

import { findByPath, type FoundByPath } from '../src/index.js'
import { describeEachSetup } from './support/boot-payload.js'
import { create } from './support/documents.js'

describeEachSetup('', {}, (test) => {
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
      '@payloadpack/path: add pathPlugin() to the Payload config before calling findByPath or backfillPaths'
    )
  })
})
