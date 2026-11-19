import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup } from './support/boot-payload.js'
import { catchFieldErrors, create, readPath, remove } from './support/documents.js'

describeEachSetup('', {}, (test) => {
  it('refuses each root segment the site serves, saying what it serves there', async () => {
    const { payload } = test
    expect(await catchFieldErrors(create(payload, 'pages', { slug: 'admin', title: 'Admin' }))).toMatchObject([
      { message: 'The site serves the CMS at /admin, so pick another slug or a parent.', path: 'slug' }
    ])
    expect(await catchFieldErrors(create(payload, 'posts', { slug: 'api', title: 'API' }, { draft: true }))).toMatchObject([
      { message: "The site serves the CMS's API at /api, so pick another slug or a parent.", path: 'slug' }
    ])
  })

  it('allows a root segment the site serves below a parent', async () => {
    const { payload } = test
    const docs = await create(payload, 'pages', { slug: 'docs', title: 'Docs' })
    const api = await create(payload, 'pages', { parent: docs.id, slug: 'api', title: 'API' })

    expect(await readPath(payload, 'pages', api.id)).toBe('/docs/api')
  })

  it('refuses a segment reserved at any depth, saying what it means', async () => {
    const { payload } = test
    const journal = await create(payload, 'pages', { slug: 'journal', title: 'Journal' })

    expect(await catchFieldErrors(create(payload, 'pages', { parent: journal.id, slug: '-', title: 'Dash' }))).toMatchObject([
      { message: "A path can't hold -, which starts the page and filters of a listing, so pick another slug.", path: 'slug' }
    ])
  })

  it('refuses a delete that would lift a child onto a root segment the site serves', async () => {
    const { payload } = test
    const help = await create(payload, 'pages', { slug: 'help', title: 'Help' })
    const admin = await create(payload, 'pages', { parent: help.id, slug: 'admin', title: 'Admin help' })

    expect(await catchFieldErrors(remove(payload, 'pages', help.id))).toMatchObject([
      { message: 'The site serves the CMS at /admin, so pick another slug or a parent.', path: 'slug' }
    ])
    expect(await readPath(payload, 'pages', admin.id)).toBe('/help/admin')
  })
})

const refusedWith = (message: string) => [{ message, path: 'slug' }]

// Without a list of root segments, the root segments of Payload's own routes are reserved.
describeEachSetup(
  "with Payload's own routes and a list of segments at any depth",
  { boot: { options: { reservedSegments: { anyDepth: ['-'] } } } },
  (test) => {
    it('refuses the admin panel and the API at the root, and allows both below a parent', async () => {
      const { payload } = test
      const docs = await create(payload, 'pages', { slug: 'docs', title: 'Docs' })

      expect(await catchFieldErrors(create(payload, 'pages', { slug: 'admin', title: 'Admin' }))).toMatchObject(
        refusedWith('The site serves the admin panel at /admin, so pick another slug or a parent.')
      )
      expect(await catchFieldErrors(create(payload, 'posts', { slug: 'api', title: 'API' }, { draft: true }))).toMatchObject(
        refusedWith('The site serves the API at /api, so pick another slug or a parent.')
      )
      expect((await create(payload, 'pages', { parent: docs.id, slug: 'admin', title: 'Admin docs' })).path).toBe('/docs/admin')
      expect((await create(payload, 'pages', { parent: docs.id, slug: 'api', title: 'API docs' })).path).toBe('/docs/api')
    })

    it('refuses a segment from a list without a reason', async () => {
      const { payload } = test
      const journal = await create(payload, 'pages', { slug: 'journal', title: 'Journal' })

      expect(await catchFieldErrors(create(payload, 'pages', { parent: journal.id, slug: '-', title: 'Dash' }))).toMatchObject(
        refusedWith("A path can't hold -, so pick another slug.")
      )
    })

    it("finds nothing below Payload's own routes, without a query", async () => {
      const { payload } = test
      const queries = await test.countQueries(async () => {
        expect(await findByPath({ path: '/admin/collections/pages', payload })).toBeNull()
        expect(await findByPath({ path: '/api/pages', payload })).toBeNull()
      })

      expect(queries).toEqual([])
    })
  }
)

describeEachSetup(
  'with routes of its own',
  { boot: { options: { reservedSegments: {} }, routes: { admin: '/', api: '/backend/v1' } } },
  (test) => {
    it('reserves the first segment of each route, and nothing for a route at the root', async () => {
      const { payload } = test

      expect(await catchFieldErrors(create(payload, 'pages', { slug: 'backend', title: 'Backend' }))).toMatchObject(
        refusedWith('The site serves the API at /backend, so pick another slug or a parent.')
      )
      expect((await create(payload, 'pages', { slug: 'admin', title: 'Admin' })).path).toBe('/admin')
      expect((await create(payload, 'pages', { slug: 'api', title: 'API' })).path).toBe('/api')
      expect((await create(payload, 'pages', { slug: 'v1', title: 'Version one' })).path).toBe('/v1')
    })
  }
)

describeEachSetup('with a list of root segments', { boot: { options: { reservedSegments: { root: ['shop'] } } } }, (test) => {
  it("refuses a segment from the list without a reason, and none of Payload's own routes", async () => {
    const { payload } = test

    expect(await catchFieldErrors(create(payload, 'pages', { slug: 'shop', title: 'Shop' }))).toMatchObject(
      refusedWith('The site serves something else at /shop, so pick another slug or a parent.')
    )
    expect((await create(payload, 'pages', { slug: 'admin', title: 'Admin' })).path).toBe('/admin')
  })
})

describeEachSetup('with an empty list of root segments', { boot: { options: { reservedSegments: { root: [] } } } }, (test) => {
  it('reserves nothing', async () => {
    const { payload } = test

    expect((await create(payload, 'pages', { slug: 'admin', title: 'Admin' })).path).toBe('/admin')
    expect((await create(payload, 'pages', { slug: 'api', title: 'API' })).path).toBe('/api')
  })
})
