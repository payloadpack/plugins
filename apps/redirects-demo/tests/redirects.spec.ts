import { expect } from '@playwright/test'

import { acceptSuggestions, createRedirect, publish, publishChange, test, toUrl, visit } from './demo'

// What only the demo reaches: its page route, its proxy and Payload's own reorder endpoint. What a
// lookup answers is tested in the package, on every database.

test('answers the redirects the demo seeds', async ({ visitor }) => {
  expect(await visit(visitor, '/kontakt')).toEqual({ location: '/contact', status: 308 })
  expect(await visit(visitor, '/campaign')).toEqual({ location: 'https://example.com/campaign', status: 307 })
  expect(await visit(visitor, '/blog/2019/05/opening-hours')).toEqual({ location: '/news/opening-hours', status: 308 })
  expect(await visit(visitor, '/opening-times')).toEqual({ location: '/news/opening-hours', status: 308 })
  expect(await visit(visitor, '/news.aspx?id=1')).toEqual({ location: '/news/opening-hours', status: 308 })
})

test('answers a redirect from a path and a query string, in the proxy', async ({ visitor }) => {
  expect(await visit(visitor, '/news.aspx?ID=1')).toEqual({ location: '/news/opening-hours', status: 308 })
  expect(await visit(visitor, '/news.aspx?id=2')).toEqual({ status: 404 })
  expect(await visit(visitor, '/news.aspx')).toEqual({ status: 404 })
})

test('reaches the proxy for a path that only starts with a segment it skips', async ({ request, visitor }) => {
  await createRedirect(request, { from: '/apiary?hive=1', to: toUrl('/bees') })
  await createRedirect(request, { from: '/administration?office=1', to: toUrl('/offices') })
  await createRedirect(request, { from: '/_nextgen?v=1', to: toUrl('/generations') })
  // The API itself never reaches the proxy, so a redirect from it never answers.
  await createRedirect(request, { from: '/api/redirects?limit=1', to: toUrl('/nowhere') })

  expect(await visit(visitor, '/apiary?hive=1')).toEqual({ location: '/bees', status: 308 })
  expect(await visit(visitor, '/administration?office=1')).toEqual({ location: '/offices', status: 308 })
  expect(await visit(visitor, '/_nextgen?v=1')).toEqual({ location: '/generations', status: 308 })
  expect(await visit(visitor, '/api/redirects?limit=1')).toEqual({ status: 200 })
})

test('lets a page win over a redirect from its path in the proxy', async ({ request, visitor }) => {
  await createRedirect(request, { from: '/menu', to: toUrl('/news') })
  expect(await visit(visitor, '/menu?utm_source=newsletter')).toEqual({ location: '/news?utm_source=newsletter', status: 308 })

  await publish(request, 'pages', { slug: 'menu', title: 'Menu' })

  const response = await visitor.get('/menu?utm_source=newsletter', { maxRedirects: 0 })
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain('<h1>Menu</h1>')
})

test('takes a redirect that matched the query string over the page at its path', async ({ request, visitor }) => {
  await publish(request, 'pages', { slug: 'products', title: 'Products' })
  await createRedirect(request, { from: '/products?id=5', to: toUrl('/shop/item-5') })

  expect(await visit(visitor, '/products?id=5')).toEqual({ location: '/shop/item-5', status: 308 })
  expect(await visit(visitor, '/products?id=6')).toEqual({ status: 200 })
})

test('never sends a visitor away from a path a document holds', async ({ request, visitor }) => {
  await createRedirect(request, { from: '/events', to: toUrl('/news') })
  expect(await visit(visitor, '/events')).toEqual({ location: '/news', status: 308 })

  await publish(request, 'pages', { slug: 'events', title: 'Events' })

  const response = await visitor.get('/events', { maxRedirects: 0 })
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain('<h1>Events</h1>')
})

test('tries the regexes in the order an editor drags them to', async ({ request, visitor }) => {
  const firstRegex = await createRedirect(request, { from: '^/order/(.*)$', match: 'regex', to: toUrl('/first/$1') })
  const secondRegex = await createRedirect(request, { from: '^/order/(.+)$', match: 'regex', to: toUrl('/second/$1') })
  expect(await visit(visitor, '/order/a')).toEqual({ location: '/first/a', status: 308 })

  // What the list sends when an editor drags the second regex above the first.
  const response = await request.post('/api/reorder', {
    data: {
      collectionSlug: 'redirects',
      docsToMove: [secondRegex.id],
      newKeyWillBe: 'less',
      orderableFieldName: '_order',
      target: { id: firstRegex.id, key: firstRegex._order }
    }
  })
  await expect(response).toBeOK()

  expect(await visit(visitor, '/order/a')).toEqual({ location: '/second/a', status: 308 })
})

test('answers 404 where the redirects two moves write send a path round in a circle', async ({ request, visitor }) => {
  const studio = await publish(request, 'pages', { slug: 'studio', title: 'Studio' })
  const kiln = await publish(request, 'pages', { parent: studio.id, slug: 'kiln', title: 'Kiln' })
  await publishChange(request, 'pages', studio.id, { slug: 'workshop' })
  await acceptSuggestions(request, ['/studio'])
  const newStudio = await publish(request, 'pages', { slug: 'studio', title: 'New studio' })

  await publishChange(request, 'pages', kiln.id, { parent: newStudio.id })
  await acceptSuggestions(request, ['/workshop/kiln'])

  expect(await visit(visitor, '/workshop/kiln')).toEqual({ location: '/studio/kiln', status: 308 })
  expect(await visit(visitor, '/studio/kiln/old-link')).toEqual({ status: 404 })
})

test('sends a moved page with a non-Latin path to its new path, encoded', async ({ request, visitor }) => {
  const greeting = await publish(request, 'pages', { slug: 'привет', title: 'Привет' })

  await publishChange(request, 'pages', greeting.id, { slug: 'мир' })
  await acceptSuggestions(request, ['/привет'])

  expect(await visit(visitor, '/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82')).toEqual({ location: '/%D0%BC%D0%B8%D1%80', status: 308 })
})
