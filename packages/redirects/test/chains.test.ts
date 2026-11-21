import { expect, it } from 'vitest'

import { describeSite } from './support/boot-payload.js'
import {
  createRedirect,
  findFoundRedirect,
  foundDocument,
  foundUrl,
  publish,
  recordHasDocument,
  toDocument,
  toUrl
} from './support/documents.js'

describeSite('findRedirect following a chain', {}, (site) => {
  const { askedPaths, hasDocument, heldPaths } = recordHasDocument()

  it('takes a visitor through a chain in one hop, permanent only if every step was', async () => {
    await createRedirect(site.payload, { from: '/one', to: toUrl('/two') })
    await createRedirect(site.payload, { from: '/two', to: toUrl('/three'), type: 'temporary' })
    await createRedirect(site.payload, { from: '/three', to: toUrl('/four') })
    heldPaths.add('/four')

    expect(await findFoundRedirect({ hasDocument, path: '/one', payload: site.payload })).toEqual(
      foundUrl('/four', { permanent: false })
    )
    expect(await findFoundRedirect({ hasDocument, path: '/three', payload: site.payload })).toEqual(foundUrl('/four'))
  })

  it('stops at a path a document holds while another redirect covers it, and at a path no redirect covers', async () => {
    await createRedirect(site.payload, { from: '/to-held', to: toUrl('/held') })
    await createRedirect(site.payload, { from: '/held', to: toUrl('/past-held') })
    await createRedirect(site.payload, { from: '/to-nowhere', to: toUrl('/nowhere') })
    heldPaths.add('/held')
    askedPaths.length = 0

    expect(await findFoundRedirect({ hasDocument, path: '/to-held', payload: site.payload })).toEqual(foundUrl('/held'))
    expect(askedPaths).toEqual(['/held'])
    expect(await findFoundRedirect({ hasDocument, path: '/to-nowhere', payload: site.payload })).toEqual(foundUrl('/nowhere'))
  })

  it('answers none for a path met twice with the same query string', async () => {
    await createRedirect(site.payload, { from: '/ping', to: toUrl('/pong') })
    await createRedirect(site.payload, { from: '/pong', to: toUrl('/ping') })
    await createRedirect(site.payload, { from: '/tick?id=7', to: toUrl('/tock') })
    await createRedirect(site.payload, { from: '/tock', to: toUrl('/tick?id=7') })

    expect(await findFoundRedirect({ hasDocument, path: '/ping', payload: site.payload })).toBeNull()
    expect(await findFoundRedirect({ hasDocument, path: '/tick', payload: site.payload, searchParams: { id: '7' } })).toBeNull()
  })

  it('follows a chain back to the path asked for, without the query string a redirect matched', async () => {
    await createRedirect(site.payload, { from: '/catalogue?id=7', to: toUrl('/catalogue') })
    await createRedirect(site.payload, { from: '/catalogue', to: toUrl('/shop') })
    heldPaths.add('/shop')

    expect(
      await findFoundRedirect({ hasDocument, path: '/catalogue', payload: site.payload, searchParams: { id: '7' } })
    ).toEqual(foundUrl('/shop', { matchedQueryString: true }))
  })

  it('answers none for a chain of more than 10 paths, and follows one of 10', async () => {
    for (let step = 1; step <= 11; step++) {
      await createRedirect(site.payload, { from: `/step-${step}`, to: toUrl(`/step-${step + 1}`) })
    }
    heldPaths.add('/step-12')

    // From step 2 the chain looks up 10 paths before it lands where a document is, and from step 1, 11.
    expect(await findFoundRedirect({ hasDocument, path: '/step-2', payload: site.payload })).toEqual(foundUrl('/step-12'))
    expect(await findFoundRedirect({ hasDocument, path: '/step-1', payload: site.payload })).toBeNull()
  })

  it('follows a chain through a path that is not Latin, asking for it decoded', async () => {
    await createRedirect(site.payload, { from: '/старый', to: toUrl('/новый') })
    await createRedirect(site.payload, { from: '/новый', to: toUrl('/final') })
    heldPaths.add('/final')
    askedPaths.length = 0

    expect(await findFoundRedirect({ hasDocument, path: '/старый', payload: site.payload })).toEqual(foundUrl('/final'))
    expect(askedPaths).toEqual(['/новый', '/final'])
  })

  it('follows a chain through a destination with a slash at its end, asking for the path without it', async () => {
    await createRedirect(site.payload, { from: '/pamphlets', to: toUrl('/leaflets/') })
    await createRedirect(site.payload, { from: '/leaflets', to: toUrl('/flyers/') })
    heldPaths.add('/flyers')
    askedPaths.length = 0

    expect(await findFoundRedirect({ hasDocument, path: '/pamphlets', payload: site.payload })).toEqual(foundUrl('/flyers/'))
    expect(askedPaths).toEqual(['/leaflets', '/flyers'])
  })

  // As a browser that follows each redirect lands: a Location without a fragment keeps the one before it.
  it('keeps the fragment of a destination in a chain where no later one has its own', async () => {
    await createRedirect(site.payload, { from: '/guide-old', to: toUrl('/guide#setup') })
    await createRedirect(site.payload, { from: '/guide', to: toUrl('/manual') })
    await createRedirect(site.payload, { from: '/manual', to: toUrl('/handbook') })
    await createRedirect(site.payload, { from: '/recipes-old', to: toUrl('/recipes#soups') })
    await createRedirect(site.payload, { from: '/recipes', to: toUrl('/cookbook#starters') })
    heldPaths.add('/handbook')
    heldPaths.add('/cookbook')

    expect(await findFoundRedirect({ hasDocument, path: '/guide-old', payload: site.payload })).toEqual(
      foundUrl('/handbook#setup')
    )
    expect(await findFoundRedirect({ hasDocument, path: '/recipes-old', payload: site.payload })).toEqual(
      foundUrl('/cookbook#starters')
    )
  })

  it('stops at a destination on another site', async () => {
    await createRedirect(site.payload, { from: '/away', to: toUrl('https://shop.example/two-away') })
    await createRedirect(site.payload, { from: '/two-away', to: toUrl('/never') })

    expect(await findFoundRedirect({ hasDocument, path: '/away', payload: site.payload })).toEqual(
      foundUrl('https://shop.example/two-away')
    )
  })

  it("never asks whether a document holds its document target's own path, and asks below it", async () => {
    const page = await publish(site.payload, 'pages', { slug: 'own-path', title: 'Own path' })
    await createRedirect(site.payload, { from: '/to-own-path', match: 'below', to: toDocument('pages', page) })
    heldPaths.add('/own-path/below')
    askedPaths.length = 0

    expect(await findFoundRedirect({ hasDocument, path: '/to-own-path', payload: site.payload })).toEqual(
      foundDocument('/own-path')
    )
    expect(askedPaths).toEqual([])
    expect(await findFoundRedirect({ hasDocument, path: '/to-own-path/below', payload: site.payload })).toEqual(
      foundDocument('/own-path/below')
    )
    expect(askedPaths).toEqual(['/own-path/below'])
  })

  it("carries the visitor's query string through a chain, each step matching it as a visitor's", async () => {
    await createRedirect(site.payload, { from: '/first-step?id=1', to: toUrl('/second-step') })
    await createRedirect(site.payload, { from: '/second-step', to: toUrl('/third-step?lang=en') })
    heldPaths.add('/third-step')

    expect(
      await findFoundRedirect({
        hasDocument,
        path: '/first-step',
        payload: site.payload,
        searchParams: { id: '1', utm_source: 'mail' }
      })
    ).toEqual(foundUrl('/third-step?lang=en&utm_source=mail', { matchedQueryString: true }))
  })

  // As a proxy asks, before it knows whether a page holds the path.
  it('never asks whether a document holds the path asked for, and says whether a redirect matched the query string', async () => {
    await createRedirect(site.payload, { from: '/held-page', to: toUrl('/elsewhere') })
    await createRedirect(site.payload, { from: '/held-page?promo=1', to: toUrl('/promo') })
    heldPaths.add('/held-page')
    heldPaths.add('/elsewhere')
    heldPaths.add('/promo')
    askedPaths.length = 0

    expect(
      await findFoundRedirect({ hasDocument, path: '/held-page', payload: site.payload, searchParams: { promo: '2' } })
    ).toEqual(foundUrl('/elsewhere?promo=2'))
    expect(
      await findFoundRedirect({ hasDocument, path: '/held-page', payload: site.payload, searchParams: { promo: '1' } })
    ).toEqual(foundUrl('/promo', { matchedQueryString: true }))
    expect(askedPaths).toEqual(['/elsewhere', '/promo'])
  })

  it('follows no chain without hasDocument', async () => {
    await createRedirect(site.payload, { from: '/no-chain-start', to: toUrl('/no-chain-middle') })
    await createRedirect(site.payload, { from: '/no-chain-middle', to: toUrl('/no-chain-end') })

    expect(await findFoundRedirect({ path: '/no-chain-start', payload: site.payload })).toEqual(foundUrl('/no-chain-middle'))
  })
})
