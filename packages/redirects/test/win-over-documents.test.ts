import { expect, it } from 'vitest'

import { findRedirect, type SearchParams } from '../src/index.js'
import { HAS_DOCUMENT_MISSING_ERROR } from '../src/plugin/messages.js'
import { describeSite } from './support/boot-payload.js'
import {
  acceptSuggestions,
  createDraft,
  createRedirect,
  findFoundRedirect,
  foundDocument,
  foundUrl,
  publish,
  publishChange,
  recordHasDocument,
  toDocument,
  toUrl
} from './support/documents.js'

describeSite("findRedirect with winOverDocuments 'perRedirect'", { redirects: { winOverDocuments: 'perRedirect' } }, (site) => {
  const { askedPaths, hasDocument, heldPaths } = recordHasDocument()
  const findAskingAnew = (path: string, searchParams?: SearchParams) => {
    askedPaths.length = 0
    return findFoundRedirect({ hasDocument, path, payload: site.payload, searchParams })
  }

  it('answers with a redirect that wins over a document where one holds its path, without asking', async () => {
    await createRedirect(site.payload, { from: '/picked', to: toUrl('/picked-target'), winsOverDocument: true })
    heldPaths.add('/picked')

    expect(await findAskingAnew('/picked')).toEqual(foundUrl('/picked-target'))
    expect(askedPaths).toEqual([])
  })

  it('lets a document win over a redirect nobody picked, asking once', async () => {
    await createRedirect(site.payload, { from: '/unpicked', to: toUrl('/unpicked-target') })
    heldPaths.add('/unpicked')

    expect(await findAskingAnew('/unpicked')).toBeNull()
    expect(askedPaths).toEqual(['/unpicked'])
  })

  it('answers with the best redirect where no document holds the path', async () => {
    await createRedirect(site.payload, { from: '/no-document', to: toUrl('/no-document-target') })

    expect(await findAskingAnew('/no-document')).toEqual(foundUrl('/no-document-target'))
    expect(askedPaths).toEqual(['/no-document'])
  })

  it('answers with a lower redirect that wins over a document where the best one does not', async () => {
    await createRedirect(site.payload, { from: '/shelf', match: 'below', to: toUrl('/picked-shelf'), winsOverDocument: true })
    await createRedirect(site.payload, { from: '/shelf/book', to: toUrl('/unpicked-book') })
    heldPaths.add('/shelf/book')

    expect(await findAskingAnew('/shelf/book')).toEqual(foundUrl('/picked-shelf/book'))
    expect(askedPaths).toEqual(['/shelf/book'])

    heldPaths.delete('/shelf/book')

    expect(await findAskingAnew('/shelf/book')).toEqual(foundUrl('/unpicked-book'))
    expect(askedPaths).toEqual(['/shelf/book'])
  })

  it('asks once the first redirect that cannot win over a document comes up, even when it sends nobody', async () => {
    const draftPage = await createDraft(site.payload, 'pages', { slug: 'draft-only', title: 'Draft only' })
    await createRedirect(site.payload, { from: '/edge', match: 'below', to: toUrl('/picked-edge'), winsOverDocument: true })
    await createRedirect(site.payload, { from: '/edge/deep', to: toDocument('pages', draftPage) })

    expect(await findAskingAnew('/edge/deep')).toEqual(foundUrl('/picked-edge/deep'))
    expect(askedPaths).toEqual(['/edge/deep'])
  })

  it('answers with a redirect that matched the query string over a document, picked or not', async () => {
    await createRedirect(site.payload, { from: '/catalog?id=5', to: toUrl('/item-5') })
    await createRedirect(site.payload, { from: '/catalog', to: toUrl('/unpicked-catalog') })
    heldPaths.add('/catalog')

    expect(await findAskingAnew('/catalog', { id: '5' })).toEqual(foundUrl('/item-5', { matchedQueryString: true }))
    expect(askedPaths).toEqual([])
    expect(await findAskingAnew('/catalog', { id: '6' })).toBeNull()
    expect(askedPaths).toEqual(['/catalog'])
  })

  it('refuses to guess without hasDocument', async () => {
    await expect(findRedirect({ path: '/picked', payload: site.payload })).rejects.toThrow(HAS_DOCUMENT_MISSING_ERROR)
  })

  it('follows a chain through a document a picked redirect wins over', async () => {
    await createRedirect(site.payload, { from: '/hop-start', to: toUrl('/hop-middle') })
    await createRedirect(site.payload, { from: '/hop-middle', to: toUrl('/hop-end'), type: 'temporary', winsOverDocument: true })
    heldPaths.add('/hop-middle')

    expect(await findAskingAnew('/hop-start')).toEqual(foundUrl('/hop-end', { permanent: false }))
    expect(askedPaths).toEqual(['/hop-start'])
  })

  it('stops a chain at a document no redirect at its path wins over', async () => {
    await createRedirect(site.payload, { from: '/stop-start', to: toUrl('/stop-middle') })
    await createRedirect(site.payload, { from: '/stop-middle', to: toUrl('/stop-end') })
    heldPaths.add('/stop-middle')

    expect(await findAskingAnew('/stop-start')).toEqual(foundUrl('/stop-middle'))
    expect(askedPaths).toEqual(['/stop-start', '/stop-middle'])
  })

  it("never asks about a destination that is its document target's own path, where only a picked redirect wins", async () => {
    const ownPage = await publish(site.payload, 'pages', { slug: 'own-page', title: 'Own page' })
    await createRedirect(site.payload, { from: '/to-own-page', to: toDocument('pages', ownPage) })
    await createRedirect(site.payload, { from: '/own-page', to: toUrl('/past-own-page') })
    const pickedPage = await publish(site.payload, 'pages', { slug: 'picked-page', title: 'Picked page' })
    await createRedirect(site.payload, { from: '/to-picked-page', to: toDocument('pages', pickedPage) })
    await createRedirect(site.payload, { from: '/picked-page', to: toUrl('/past-picked-page'), winsOverDocument: true })

    expect(await findAskingAnew('/to-own-page')).toEqual(foundDocument('/own-page'))
    expect(askedPaths).toEqual(['/to-own-page'])
    expect(await findAskingAnew('/to-picked-page')).toEqual(foundUrl('/past-picked-page'))
    expect(askedPaths).toEqual(['/to-picked-page'])
  })

  it('keeps a suggestion said yes to from winning over a document', async () => {
    const harbour = await publish(site.payload, 'pages', { slug: 'harbour', title: 'Harbour' })
    await publishChange(site.payload, 'pages', harbour, { slug: 'quay' })
    await acceptSuggestions(site.payload, ['/harbour'])

    expect(await findAskingAnew('/harbour/crane')).toEqual(foundDocument('/quay/crane'))

    heldPaths.add('/harbour/crane')

    expect(await findAskingAnew('/harbour/crane')).toBeNull()
  })
})

describeSite("findRedirect with winOverDocuments 'always'", { redirects: { winOverDocuments: 'always' } }, (site) => {
  // Every redirect that is on wins over a document, so findRedirect never asks.
  const hasDocument = (): boolean => expect.unreachable('hasDocument was asked')

  it('answers with every redirect that is on where a document holds its path', async () => {
    await publish(site.payload, 'pages', { slug: 'held', title: 'Held' })
    await createRedirect(site.payload, { from: '/held', to: toUrl('/past-held') })

    expect(await findFoundRedirect({ hasDocument, path: '/held', payload: site.payload })).toEqual(foundUrl('/past-held'))
    expect(await findFoundRedirect({ path: '/held', payload: site.payload })).toEqual(foundUrl('/past-held'))
  })

  it('follows a chain through documents, without hasDocument, permanent only if every step was', async () => {
    const firstStop = await publish(site.payload, 'pages', { slug: 'first-stop', title: 'First stop' })
    const lastStop = await publish(site.payload, 'pages', { slug: 'last-stop', title: 'Last stop' })
    await createRedirect(site.payload, { from: '/chain-start', to: toDocument('pages', firstStop) })
    await createRedirect(site.payload, { from: '/first-stop', to: toUrl('/chain-middle'), type: 'temporary' })
    await createRedirect(site.payload, { from: '/chain-middle', to: toDocument('pages', lastStop) })

    expect(await findFoundRedirect({ hasDocument, path: '/chain-start', payload: site.payload })).toEqual(
      foundDocument('/last-stop', { permanent: false })
    )
    expect(await findFoundRedirect({ path: '/chain-start', payload: site.payload })).toEqual(
      foundDocument('/last-stop', { permanent: false })
    )
  })

  it('answers with a redirect from a query string to the path it was asked for, a document there or not', async () => {
    const page = await publish(site.payload, 'pages', { slug: 'page-by-id', title: 'Page by id' })
    await createRedirect(site.payload, { from: '/page-by-id?id=1', to: toDocument('pages', page) })
    await createRedirect(site.payload, { from: '/strip?old=1', to: toUrl('/strip') })

    expect(
      await findFoundRedirect({ hasDocument, path: '/page-by-id', payload: site.payload, searchParams: { id: '1' } })
    ).toEqual(foundDocument('/page-by-id', { matchedQueryString: true }))
    expect(await findFoundRedirect({ hasDocument, path: '/strip', payload: site.payload, searchParams: { old: '1' } })).toEqual(
      foundUrl('/strip', { matchedQueryString: true })
    )
  })

  it('follows a redirect from a query string back to the path asked for, where another redirect answers', async () => {
    await createRedirect(site.payload, { from: '/back?old=1', to: toUrl('/back') })
    await createRedirect(site.payload, { from: '/back', to: toUrl('/onward') })

    expect(await findFoundRedirect({ hasDocument, path: '/back', payload: site.payload, searchParams: { old: '1' } })).toEqual(
      foundUrl('/onward', { matchedQueryString: true })
    )
  })

  it('answers none for a path met twice', async () => {
    await createRedirect(site.payload, { from: '/ping', to: toUrl('/pong') })
    await createRedirect(site.payload, { from: '/pong', to: toUrl('/ping') })

    expect(await findFoundRedirect({ hasDocument, path: '/ping', payload: site.payload })).toBeNull()
  })

  it('answers none for a redirect that covers its own destination', async () => {
    const latestNews = await publish(site.payload, 'news', { slug: 'latest', title: 'Latest' })
    await createRedirect(site.payload, { from: '/news', match: 'below', to: toDocument('news', latestNews) })

    expect(await findFoundRedirect({ hasDocument, path: '/news', payload: site.payload })).toBeNull()
  })

  it('answers none for a chain of more than 10 paths, and follows one of 10', async () => {
    for (let step = 1; step <= 11; step++) {
      await createRedirect(site.payload, { from: `/step-${step}`, to: toUrl(`/step-${step + 1}`) })
    }

    // From step 2 the chain leaves 10 paths and ends at step 12, which no redirect covers, and from
    // step 1 it would leave an 11th.
    expect(await findFoundRedirect({ hasDocument, path: '/step-2', payload: site.payload })).toEqual(foundUrl('/step-12'))
    expect(await findFoundRedirect({ hasDocument, path: '/step-1', payload: site.payload })).toBeNull()
  })
})
