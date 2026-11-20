import { commitTransaction, createPayloadRequest, initTransaction, killTransaction, type User } from 'payload'
import { expect, expectTypeOf, it, onTestFinished } from 'vitest'

import { findByPath, findPaths, type FoundByPath, type FoundPath } from '../src/index.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
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
    expect(await findByPath({ path: '/plans', paths: true, payload })).toMatchObject({ paths: [at('en', '/plans')] })
  })

  it('forwards select in include and exclude modes without breaking published checks', async () => {
    const { payload } = test
    const live = await create(payload, 'pages', { slug: 'select-live', title: 'Select live' })
    const unpublished = await create(payload, 'pages', { slug: 'select-draft', title: 'Select draft' }, { draft: true })
    const notice = await create(payload, 'notices', { slug: 'select-notice', title: 'Select notice' })

    // Include mode without _status still checks published status and strips _status from the result.
    const included = await findByPath({
      collections: ['pages'],
      path: '/select-live',
      paths: true,
      payload,
      select: { title: true }
    })
    expect(included).toEqual({
      collection: 'pages',
      document: { id: live.id, title: 'Select live' },
      paths: [at('en', '/select-live')]
    })
    expect(await findByPath({ collections: ['pages'], path: '/select-draft', payload, select: { title: true } })).toBeNull()
    expect(
      await findByPath({ collections: ['pages'], draft: true, path: '/select-draft', payload, select: { title: true } })
    ).toEqual({
      collection: 'pages',
      document: { id: unpublished.id, title: 'Select draft' }
    })

    // Include mode with _status keeps _status on the returned document.
    const withStatus = await findByPath({
      collections: ['pages'],
      path: '/select-live',
      payload,
      select: { _status: true, title: true }
    })
    expect(withStatus).toEqual({
      collection: 'pages',
      document: { _status: 'published', id: live.id, title: 'Select live' }
    })

    // Empty select returns id only while still checking published status.
    expect(await findByPath({ collections: ['pages'], path: '/select-live', payload, select: {} })).toEqual({
      collection: 'pages',
      document: { id: live.id }
    })
    expect(await findByPath({ collections: ['pages'], path: '/select-draft', payload, select: {} })).toBeNull()

    // Exclude mode with _status: false alone returns every other field and omits _status.
    const withoutStatusOnly = await findByPath({
      collections: ['pages'],
      path: '/select-live',
      payload,
      select: { _status: false }
    })
    expect(withoutStatusOnly?.document).toMatchObject({
      id: live.id,
      path: '/select-live',
      slug: 'select-live',
      title: 'Select live'
    })
    expect(withoutStatusOnly?.document).not.toHaveProperty('_status')

    // Exclude mode with other fields and _status: false omits both.
    const withoutTitleAndStatus = await findByPath({
      collections: ['pages'],
      path: '/select-live',
      payload,
      select: { _status: false, title: false }
    })
    expect(withoutTitleAndStatus?.document).toMatchObject({ id: live.id, path: '/select-live', slug: 'select-live' })
    expect(withoutTitleAndStatus?.document).not.toHaveProperty('title')
    expect(withoutTitleAndStatus?.document).not.toHaveProperty('_status')

    // Exclude mode without _status keeps _status.
    const withoutTitle = await findByPath({
      collections: ['pages'],
      path: '/select-live',
      payload,
      select: { title: false }
    })
    expect(withoutTitle?.document).toMatchObject({ _status: 'published', id: live.id, slug: 'select-live' })
    expect(withoutTitle?.document).not.toHaveProperty('title')

    // A collection without drafts passes select through as-is.
    expect(await findByPath({ collections: ['notices'], path: '/select-notice', payload, select: { title: true } })).toEqual({
      collection: 'notices',
      document: { id: notice.id, title: 'Select notice' }
    })
  })

  it('forwards populate to control fields on populated relationships', async () => {
    const { payload } = test
    const parent = await create(payload, 'pages', { slug: 'pop-parent', title: 'Pop parent' })
    await create(payload, 'pages', { parent: parent.id, slug: 'pop-child', title: 'Pop child' })

    const found = await findByPath({
      collections: ['pages'],
      depth: 1,
      path: '/pop-parent/pop-child',
      payload,
      populate: { pages: { title: true } }
    })
    expect(found?.document.parent).toEqual({ id: parent.id, title: 'Pop parent' })
  })

  it('merges where with the path and published filters', async () => {
    const { payload } = test
    const page = await create(payload, 'pages', { slug: 'where-page', title: 'Where page' })
    await create(payload, 'pages', { slug: 'where-draft', title: 'Where draft' }, { draft: true })

    expect(
      await findByPath({
        collections: ['pages'],
        path: '/where-page',
        payload,
        where: { title: { equals: 'Where page' } }
      })
    ).toMatchObject({ collection: 'pages', document: { id: page.id } })

    expect(
      await findByPath({
        collections: ['pages'],
        path: '/where-page',
        payload,
        where: { title: { equals: 'Something else' } }
      })
    ).toBeNull()

    expect(
      await findByPath({
        collections: ['pages'],
        path: '/where-draft',
        payload,
        where: { title: { equals: 'Where draft' } }
      })
    ).toBeNull()
  })

  it('forwards fallbackLocale independently of the path lookup', async () => {
    if (!setup.localized) return
    const { payload } = test
    const page = await create(payload, 'pages', { slug: 'fb-page', title: 'English title' })
    await update(payload, 'pages', page.id, { slug: 'fb-sv' }, { locale: 'sv' })

    expect(await findByPath({ collections: ['pages'], locale: 'sv', path: '/fb-sv', payload })).toMatchObject({
      document: { id: page.id, title: 'English title' }
    })
    const withoutFallback = await findByPath({
      collections: ['pages'],
      fallbackLocale: false,
      locale: 'sv',
      path: '/fb-sv',
      payload
    })
    expect(withoutFallback?.document.id).toBe(page.id)
    expect(withoutFallback?.document.title ?? null).toBeNull()
  })

  it('reads uncommitted writes inside req transaction across multiple collections and with paths', async () => {
    const { payload } = test
    const req = await createPayloadRequest({ payload })
    await initTransaction(req)
    onTestFinished(() => killTransaction(req))

    const created = await payload.create({
      collection: 'pages',
      data: { _status: 'published', slug: 'tx-page', title: 'Tx page' },
      overrideAccess: true,
      req
    })

    const found = await findByPath({ path: '/tx-page', paths: true, payload, req })
    expect(found).toMatchObject({
      collection: 'pages',
      document: { id: created.id, title: 'Tx page' },
      paths: [at('en', '/tx-page')]
    })

    await killTransaction(req)
    expect(await findByPath({ path: '/tx-page', payload })).toBeNull()

    // Also verify a committed transaction works cleanly.
    const commitReq = await createPayloadRequest({ payload })
    await initTransaction(commitReq)
    const committed = await payload.create({
      collection: 'pages',
      data: { _status: 'published', slug: 'tx-committed', title: 'Tx committed' },
      overrideAccess: true,
      req: commitReq
    })
    await commitTransaction(commitReq)
    expect(await findByPath({ path: '/tx-committed', payload })).toMatchObject({
      collection: 'pages',
      document: { id: committed.id }
    })
  })
})

describeEachSetup(
  'forwarding access, context and hidden field options',
  {
    boot: (setup) => ({
      collections: [
        {
          ...titled('members', setup.localized, [
            { name: 'public', type: 'checkbox' },
            { hidden: true, name: 'secret', type: 'text' },
            { name: 'note', type: 'text' }
          ]),
          access: {
            read: ({ req }) => (req.user ? true : { public: { equals: true } })
          },
          hooks: {
            afterRead: [({ context, doc }) => (typeof context.tag === 'string' ? { ...doc, note: context.tag } : doc)]
          }
        }
      ],
      options: { collections: ['members'] }
    })
  },
  (test) => {
    it('forwards overrideAccess, user, showHiddenFields and context', async () => {
      const { payload } = test
      const publicDoc = await create(payload, 'members', {
        public: true,
        secret: 'hidden-public',
        slug: 'welcome',
        title: 'Welcome'
      })
      const privateDoc = await create(payload, 'members', {
        public: false,
        secret: 'hidden-private',
        slug: 'vault',
        title: 'Vault'
      })

      // Defaults to overrideAccess: true (server read) and hides hidden fields.
      const defaultFound = await findByPath({ collections: ['members'], path: '/vault', payload })
      expect(defaultFound).toMatchObject({ collection: 'members', document: { id: privateDoc.id } })
      expect(defaultFound?.document).not.toHaveProperty('secret')

      // overrideAccess: false respects access control with and without user.
      expect(await findByPath({ collections: ['members'], overrideAccess: false, path: '/vault', payload })).toBeNull()
      expect(await findByPath({ collections: ['members'], overrideAccess: false, path: '/welcome', payload })).toMatchObject({
        document: { id: publicDoc.id }
      })
      expect(
        await findByPath({
          collections: ['members'],
          overrideAccess: false,
          path: '/vault',
          payload,
          user: { id: 'member-1' } as unknown as User
        })
      ).toMatchObject({ document: { id: privateDoc.id } })

      // showHiddenFields: true includes hidden fields.
      expect(await findByPath({ collections: ['members'], path: '/vault', payload, showHiddenFields: true })).toMatchObject({
        document: { id: privateDoc.id, secret: 'hidden-private' }
      })

      // context is forwarded to hooks.
      expect(
        await findByPath({ collections: ['members'], context: { tag: 'from-hook' }, path: '/welcome', payload })
      ).toMatchObject({ document: { id: publicDoc.id, note: 'from-hook' } })
    })
  }
)

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
    const queries = await test.countQueries(async () => {
      expect(await findByPath({ collections: ['posts'], path: '/tours', payload })).toBeNull()
    })
    expect(queries.map(({ collection }) => collection)).toEqual(['posts'])

    const inBoth = await findByPath({ collections: ['pages', 'posts'], path: '/tours', payload })
    expectTypeOf(inBoth).toEqualTypeOf<FoundByPath<'pages' | 'posts'> | null>()
    expect(inBoth).toMatchObject({ collection: 'pages', document: { id: tours.id } })
    expectTypeOf(await findByPath({ path: '/tours', payload })).toEqualTypeOf<FoundByPath | null>()

    // Omitted payload.find options are rejected by the type.
    if (false as boolean) {
      // @ts-expect-error collection is replaced by collections
      await findByPath({ collection: 'pages', path: '/tours', payload })
      // @ts-expect-error limit does not apply to a unique path lookup
      await findByPath({ limit: 1, path: '/tours', payload })
      // @ts-expect-error pagination is always false
      await findByPath({ pagination: true, path: '/tours', payload })
      // @ts-expect-error sort does not apply to a unique path lookup
      await findByPath({ path: '/tours', payload, sort: 'title' })
      // @ts-expect-error trashed documents take no path
      await findByPath({ path: '/tours', payload, trash: true })
    }
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
