import { findByPath } from '@payloadpack/path'
import {
  APIError,
  createPayloadRequest,
  initTransaction,
  killTransaction,
  type CollectionAfterChangeHook,
  type CollectionBeforeDeleteHook
} from 'payload'
import { expect, it } from 'vitest'

import { suggestRedirects } from '../src/index.js'
import { describeSite, type Site } from './support/boot-payload.js'
import {
  acceptSuggestions,
  createDraft,
  createRedirect,
  findFoundRedirect,
  foundDocument,
  findRedirects,
  publish,
  publishChange,
  remove,
  toDocument,
  toUrl
} from './support/documents.js'

// As a site asks: only for a path no published document holds, and following chains by the same rule.
async function visit({ payload }: Site, path: string, locale?: string) {
  const hasDocument = async (pathAsked: string) => (await findByPath({ locale, path: pathAsked, payload })) !== null
  if (await hasDocument(path)) return 'document'
  return findFoundRedirect({ hasDocument, locale, path, payload })
}

const findRedirectsFrom = async ({ payload }: Site, froms: string[]) =>
  (await findRedirects(payload)).filter(({ from }) => froms.includes(from))

const targetOf = (collection: string, { id }: { id: number | string }) => `${collection}:${id}`

// Sorted by from, as findRedirects reads them.
const describeRedirects = async (site: Site, froms: string[]) =>
  (await findRedirectsFrom(site, froms)).map(({ from, status, to }) => ({
    from,
    status,
    to: to.type === 'document' ? targetOf(to.document!.relationTo, { id: to.document!.value }) : to.url
  }))

describeSite('the redirects a move suggests', {}, (site, setup) => {
  it('suggests one redirect from the old path and every path below it to the moved document', async () => {
    const team = await publish(site.payload, 'pages', { slug: 'team', title: 'Team' })
    await publish(site.payload, 'pages', { parent: team.id, slug: 'anna', title: 'Anna' })

    await publishChange(site.payload, 'pages', team, { slug: 'people' })

    expect(await findRedirectsFrom(site, ['/team', '/team/anna', '/people', '/people/anna'])).toEqual([
      expect.objectContaining({
        from: '/team',
        match: 'below',
        status: 'suggested',
        to: expect.objectContaining({ document: { relationTo: 'pages', value: team.id }, type: 'document' }),
        type: 'permanent'
      })
    ])
  })

  it('answers no lookup with a suggestion until someone says yes', async () => {
    const services = await publish(site.payload, 'pages', { slug: 'services', title: 'Services' })
    await publish(site.payload, 'pages', { parent: services.id, slug: 'design', title: 'Design' })
    await publishChange(site.payload, 'pages', services, { slug: 'offering' })

    expect(await visit(site, '/services/design')).toBeNull()

    await acceptSuggestions(site.payload, ['/services'])

    expect(await visit(site, '/services')).toEqual(foundDocument('/offering'))
    expect(await visit(site, '/services/design')).toEqual(foundDocument('/offering/design'))
  })

  it('deletes a redirect to the moved document from its new path, whatever its status', async () => {
    const pier = await publish(site.payload, 'pages', { slug: 'pier', title: 'Pier' })
    const jetty = await publish(site.payload, 'pages', { slug: 'jetty', title: 'Jetty' })
    await createRedirect(site.payload, { from: '/quay', match: 'below', to: toDocument('pages', pier) })
    await createRedirect(site.payload, { from: '/wharf', status: 'off', to: toDocument('pages', jetty) })

    await publishChange(site.payload, 'pages', pier, { slug: 'quay' })
    await publishChange(site.payload, 'pages', jetty, { slug: 'wharf' })

    expect(await describeRedirects(site, ['/quay', '/wharf'])).toEqual([])
    expect(await findFoundRedirect({ path: '/quay/old-link', payload: site.payload })).toBeNull()
  })

  it('makes no circle when a page moves back to its old path, and suggests its other one', async () => {
    const harbour = await publish(site.payload, 'pages', { slug: 'harbour', title: 'Harbour' })
    await publishChange(site.payload, 'pages', harbour, { slug: 'port' })
    await acceptSuggestions(site.payload, ['/harbour'])

    await publishChange(site.payload, 'pages', harbour, { slug: 'harbour' })

    expect(await describeRedirects(site, ['/harbour', '/port'])).toEqual([
      { from: '/port', status: 'suggested', to: targetOf('pages', harbour) }
    ])
    await acceptSuggestions(site.payload, ['/port'])
    expect(await findFoundRedirect({ path: '/harbour/old-link', payload: site.payload })).toBeNull()
    expect(await findFoundRedirect({ path: '/port/old-link', payload: site.payload })).toEqual(foundDocument('/harbour/old-link'))
  })

  // The suggestion the first move left from /dock goes with the move back, so the third move's from
  // /dock doesn't meet it on the unique from.
  it('suggests a redirect from a path a page moved away from twice', async () => {
    const dock = await publish(site.payload, 'pages', { slug: 'dock', title: 'Dock' })
    await publishChange(site.payload, 'pages', dock, { slug: 'berth' })
    await publishChange(site.payload, 'pages', dock, { slug: 'dock' })

    await publishChange(site.payload, 'pages', dock, { slug: 'mooring' })

    expect(await describeRedirects(site, ['/dock', '/berth'])).toEqual([
      { from: '/berth', status: 'suggested', to: targetOf('pages', dock) },
      { from: '/dock', status: 'suggested', to: targetOf('pages', dock) }
    ])
  })

  it('deletes the suggestion from the path a document moves to, which another document left', async () => {
    const kiosk = await publish(site.payload, 'pages', { slug: 'kiosk', title: 'Kiosk' })
    const stall = await publish(site.payload, 'pages', { slug: 'stall', title: 'Stall' })
    await publishChange(site.payload, 'pages', kiosk, { slug: 'booth' })

    await publishChange(site.payload, 'pages', stall, { slug: 'kiosk' })

    expect(await describeRedirects(site, ['/kiosk', '/stall', '/booth'])).toEqual([
      { from: '/stall', status: 'suggested', to: targetOf('pages', stall) }
    ])
  })

  it('leaves an editor’s redirect to anything else at the path a document moves to', async () => {
    const shed = await publish(site.payload, 'pages', { slug: 'shed', title: 'Shed' })
    const barn = await publish(site.payload, 'pages', { slug: 'barn', title: 'Barn' })
    const otherPage = await publish(site.payload, 'pages', { slug: 'other', title: 'Other' })
    await createRedirect(site.payload, { from: '/garage', to: toUrl('/elsewhere') })
    await createRedirect(site.payload, { from: '/stable', status: 'off', to: toDocument('pages', otherPage) })

    await publishChange(site.payload, 'pages', shed, { slug: 'garage' })
    await publishChange(site.payload, 'pages', barn, { slug: 'stable' })

    expect(await describeRedirects(site, ['/garage', '/stable'])).toEqual([
      { from: '/garage', status: 'on', to: '/elsewhere' },
      { from: '/stable', status: 'off', to: targetOf('pages', otherPage) }
    ])
  })

  it('suggests none from an old path an editor’s redirect holds, on or off, and leaves it as it is', async () => {
    const mill = await publish(site.payload, 'pages', { slug: 'mill', title: 'Mill' })
    const forge = await publish(site.payload, 'pages', { slug: 'forge', title: 'Forge' })
    await createRedirect(site.payload, { from: '/mill', to: toUrl('/flour') })
    await createRedirect(site.payload, { from: '/forge', status: 'off', to: toUrl('/iron') })

    await publishChange(site.payload, 'pages', mill, { slug: 'bakehouse' })
    await publishChange(site.payload, 'pages', forge, { slug: 'smithy' })

    expect(await describeRedirects(site, ['/mill', '/forge'])).toEqual([
      { from: '/forge', status: 'off', to: '/iron' },
      { from: '/mill', status: 'on', to: '/flour' }
    ])
  })

  it('suggests one from the old path of each page right below a moved page whose old path an editor’s redirect keeps', async () => {
    const crew = await publish(site.payload, 'pages', { slug: 'crew', title: 'Crew' })
    const anna = await publish(site.payload, 'pages', { parent: crew.id, slug: 'anna', title: 'Anna' })
    await publish(site.payload, 'pages', { parent: anna.id, slug: 'cv', title: 'CV' })
    await createRedirect(site.payload, { from: '/crew', to: toUrl('/elsewhere') })

    await publishChange(site.payload, 'pages', crew, { slug: 'staff' })
    await acceptSuggestions(site.payload, ['/crew/anna'])

    expect(await describeRedirects(site, ['/crew', '/crew/anna', '/crew/anna/cv'])).toEqual([
      { from: '/crew', status: 'on', to: '/elsewhere' },
      { from: '/crew/anna', status: 'on', to: targetOf('pages', anna) }
    ])
    expect(await visit(site, '/crew/anna/cv')).toEqual(foundDocument('/staff/anna/cv'))
  })

  it('replaces a suggestion from the old path with the newer move’s', async () => {
    const firstLobby = await publish(site.payload, 'pages', { slug: 'lobby', title: 'First' })
    await publishChange(site.payload, 'pages', firstLobby, { slug: 'foyer' })
    const secondLobby = await publish(site.payload, 'pages', { slug: 'lobby', title: 'Second' })

    await publishChange(site.payload, 'pages', secondLobby, { slug: 'hall' })

    expect(await describeRedirects(site, ['/lobby'])).toEqual([
      { from: '/lobby', status: 'suggested', to: targetOf('pages', secondLobby) }
    ])
  })

  it('gives way with an earlier suggestion from the old path to the newer move’s', async () => {
    const plaza = await publish(site.payload, 'pages', { slug: 'plaza', title: 'Plaza' })
    await createRedirect(site.payload, { from: '/square', match: 'below', status: 'suggested', to: toUrl('/elsewhere') })
    const req = await createPayloadRequest({ payload: site.payload })

    await suggestRedirects({
      changedPaths: [{ collection: 'pages', from: '/square', id: plaza.id, to: '/plaza' }],
      payload: site.payload,
      req
    })

    expect(await describeRedirects(site, ['/square'])).toEqual([
      { from: '/square', status: 'suggested', to: targetOf('pages', plaza) }
    ])
  })

  it('deletes the suggestion from the path a page is published at, which a document holds now', async () => {
    const quayside = await publish(site.payload, 'pages', { slug: 'quayside', title: 'Quayside' })
    await publishChange(site.payload, 'pages', quayside, { slug: 'waterfront' })

    await publish(site.payload, 'pages', { slug: 'quayside', title: 'New quayside' })

    expect(await describeRedirects(site, ['/quayside'])).toEqual([])
  })

  // One save moves one branch, so two documents that swap paths are reported as one change.
  it('suggests none for two documents that swap paths in one change, and deletes the suggestions at both', async () => {
    const left = await publish(site.payload, 'pages', { slug: 'left', title: 'Left' })
    const right = await publish(site.payload, 'pages', { slug: 'right', title: 'Right' })
    const gonePage = await publish(site.payload, 'pages', { slug: 'gone', title: 'Gone' })
    await createRedirect(site.payload, {
      from: '/swap-a',
      match: 'below',
      status: 'suggested',
      to: toDocument('pages', gonePage)
    })
    await createRedirect(site.payload, {
      from: '/swap-b',
      match: 'below',
      status: 'suggested',
      to: toDocument('pages', gonePage)
    })
    const req = await createPayloadRequest({ payload: site.payload })

    await suggestRedirects({
      changedPaths: [
        { collection: 'pages', from: '/swap-a', id: left.id, to: '/swap-b' },
        { collection: 'pages', from: '/swap-b', id: right.id, to: '/swap-a' }
      ],
      payload: site.payload,
      req
    })

    expect(await describeRedirects(site, ['/swap-a', '/swap-b'])).toEqual([])
  })

  it('suggests one from the old path of each page right below two documents that swap paths', async () => {
    const north = await publish(site.payload, 'pages', { slug: 'north', title: 'North' })
    const northBelow = await publish(site.payload, 'pages', { parent: north.id, slug: 'below', title: 'Below' })
    const south = await publish(site.payload, 'pages', { slug: 'south', title: 'South' })
    const req = await createPayloadRequest({ payload: site.payload })

    await suggestRedirects({
      changedPaths: [
        { collection: 'pages', from: '/swap-c', id: north.id, to: '/swap-d' },
        { collection: 'pages', from: '/swap-c/below', id: northBelow.id, to: '/swap-d/below' },
        { collection: 'pages', from: '/swap-d', id: south.id, to: '/swap-c' }
      ],
      payload: site.payload,
      req
    })

    expect(await describeRedirects(site, ['/swap-c', '/swap-c/below', '/swap-d'])).toEqual([
      { from: '/swap-c/below', status: 'suggested', to: targetOf('pages', northBelow) }
    ])
  })

  it('suggests none from an old path another document of the same change moved to', async () => {
    const front = await publish(site.payload, 'pages', { slug: 'front', title: 'Front' })
    const back = await publish(site.payload, 'pages', { slug: 'back', title: 'Back' })
    const req = await createPayloadRequest({ payload: site.payload })

    await suggestRedirects({
      changedPaths: [
        { collection: 'pages', from: '/chain-a', id: front.id, to: '/chain-b' },
        { collection: 'pages', from: '/chain-b', id: back.id, to: '/chain-c' }
      ],
      payload: site.payload,
      req
    })

    expect(await describeRedirects(site, ['/chain-a', '/chain-b', '/chain-c'])).toEqual([
      { from: '/chain-a', status: 'suggested', to: targetOf('pages', front) }
    ])
  })

  it('answers none where the redirects two accepted moves write send a path round in a circle', async () => {
    const studio = await publish(site.payload, 'pages', { slug: 'studio', title: 'Studio' })
    const kiln = await publish(site.payload, 'pages', { parent: studio.id, slug: 'kiln', title: 'Kiln' })
    await publishChange(site.payload, 'pages', studio, { slug: 'workshop' })
    await acceptSuggestions(site.payload, ['/studio'])
    const newStudio = await publish(site.payload, 'pages', { slug: 'studio', title: 'New studio' })

    await publishChange(site.payload, 'pages', kiln, { parent: newStudio.id })
    await acceptSuggestions(site.payload, ['/workshop/kiln'])

    expect(await visit(site, '/workshop/kiln')).toEqual(foundDocument('/studio/kiln'))
    expect(await visit(site, '/studio/kiln/old-link')).toBeNull()
  })

  it('sends the oldest path of a page moved twice to its newest in one hop, once both are accepted', async () => {
    const gallery = await publish(site.payload, 'pages', { slug: 'gallery', title: 'Gallery' })
    await publish(site.payload, 'pages', { parent: gallery.id, slug: 'prints', title: 'Prints' })
    await publishChange(site.payload, 'pages', gallery, { slug: 'exhibition' })

    await publishChange(site.payload, 'pages', gallery, { slug: 'collection' })
    await acceptSuggestions(site.payload, ['/gallery', '/exhibition'])

    expect(await visit(site, '/gallery/prints')).toEqual(foundDocument('/collection/prints'))
    expect(await visit(site, '/exhibition/prints')).toEqual(foundDocument('/collection/prints'))
  })

  it('suggests a redirect from the old path of each child a deleted page lifts', async () => {
    const workshops = await publish(site.payload, 'pages', { slug: 'workshops', title: 'Workshops' })
    const pottery = await publish(site.payload, 'pages', { parent: workshops.id, slug: 'pottery', title: 'Pottery' })
    const weaving = await publish(site.payload, 'pages', { parent: workshops.id, slug: 'weaving', title: 'Weaving' })

    await remove(site.payload, 'pages', workshops)

    expect(await describeRedirects(site, ['/workshops', '/workshops/pottery', '/workshops/weaving'])).toEqual([
      { from: '/workshops/pottery', status: 'suggested', to: targetOf('pages', pottery) },
      { from: '/workshops/weaving', status: 'suggested', to: targetOf('pages', weaving) }
    ])
    await acceptSuggestions(site.payload, ['/workshops/pottery', '/workshops/weaving'])
    expect(await visit(site, '/workshops')).toBeNull()
    expect(await visit(site, '/workshops/pottery')).toEqual(foundDocument('/pottery'))
    expect(await visit(site, '/workshops/weaving/x')).toEqual(foundDocument('/weaving/x'))
  })

  it('sends a grandchild a bulk delete lifts twice to where it ends up', async () => {
    const parent = await publish(site.payload, 'pages', { slug: 'p', title: 'P' })
    const child = await publish(site.payload, 'pages', { parent: parent.id, slug: 'c', title: 'C' })
    await publish(site.payload, 'pages', { parent: child.id, slug: 'g', title: 'G' })

    await site.payload.delete({ collection: 'pages', overrideAccess: true, where: { id: { in: [parent.id, child.id] } } })
    await acceptSuggestions(site.payload, ['/p/c/g', '/c/g'])

    expect(await visit(site, '/p/c/g')).toEqual(foundDocument('/g'))
  })

  // Payload runs the hooks after a bulk delete all at once, and its orderable puts a new redirect after
  // the last one stored.
  it('gives each suggestion of one bulk delete a place of its own in the editors’ order, after the redirects before it', async () => {
    const aisles = []
    for (let index = 0; index < 20; index++) {
      const aisle = await publish(site.payload, 'pages', { slug: `aisle-${index}`, title: `Aisle ${index}` })
      await publish(site.payload, 'pages', { parent: aisle.id, slug: `shelf-${index}`, title: `Shelf ${index}` })
      aisles.push(aisle)
    }
    const ordersBefore = (await findRedirects(site.payload)).map(({ _order }) => _order)
    const lastOrderBefore = ordersBefore.sort().at(-1) ?? ''

    await site.payload.delete({ collection: 'pages', overrideAccess: true, where: { id: { in: aisles.map(({ id }) => id) } } })

    const shelfPaths = aisles.map((_, index) => `/aisle-${index}/shelf-${index}`)
    const orders = (await findRedirectsFrom(site, shelfPaths)).map(({ _order }) => _order)
    expect(orders).toHaveLength(aisles.length)
    expect(new Set(orders).size).toBe(aisles.length)
    expect(orders.filter((order) => order <= lastOrderBefore)).toEqual([])
  })

  // A page a site doesn't show reports no delete of its own, only the pages it lifts, which the same
  // bulk delete may take away too.
  it('deletes a parent a site does not show with its published child in one bulk delete, suggesting no redirect to either', async () => {
    const draftParent = await createDraft(site.payload, 'pages', { slug: 'draft-shelf', title: 'Draft shelf' })
    const unpublishedParent = await publish(site.payload, 'pages', { slug: 'unpublished-shelf', title: 'Unpublished shelf' })
    const trashedParent = await publish(site.payload, 'pages', { slug: 'trashed-shelf', title: 'Trashed shelf' })
    const families = []
    for (const parent of [draftParent, unpublishedParent, trashedParent]) {
      families.push({ child: await publish(site.payload, 'pages', { parent: parent.id, slug: 'book', title: 'Book' }), parent })
    }
    await site.payload.update({ collection: 'pages', data: { _status: 'draft' }, id: unpublishedParent.id, overrideAccess: true })
    await site.payload.update({
      collection: 'pages',
      data: { deletedAt: new Date().toISOString() },
      id: trashedParent.id,
      overrideAccess: true
    })

    for (const { child, parent } of families) {
      const { docs, errors } = await site.payload.delete({
        collection: 'pages',
        overrideAccess: true,
        trash: true,
        where: { id: { in: [parent.id, child.id] } }
      })

      expect({ deleted: docs.length, errors }).toEqual({ deleted: 2, errors: [] })
    }
    const { docs: storedPages } = await site.payload.find({
      collection: 'pages',
      overrideAccess: true,
      trash: true,
      where: { id: { in: families.flatMap(({ child, parent }) => [parent.id, child.id]) } }
    })
    expect(storedPages).toEqual([])
    expect(
      await describeRedirects(site, ['/draft-shelf/book', '/unpublished-shelf/book', '/trashed-shelf/book', '/book'])
    ).toEqual([])
  })

  it('deletes every page of a bulk delete that also holds a parent a site does not show, and suggests a redirect to each page it lifts that stays', async () => {
    const landing = await publish(site.payload, 'pages', { slug: 'campaign', title: 'Campaign' })
    const offer = await publish(site.payload, 'pages', { parent: landing.id, slug: 'offer', title: 'Offer' })
    await site.payload.update({ collection: 'pages', data: { _status: 'draft' }, id: landing.id, overrideAccess: true })
    const firstSection = await publish(site.payload, 'pages', { slug: 'section-0', title: 'Section 0' })
    const secondSection = await publish(site.payload, 'pages', { slug: 'section-1', title: 'Section 1' })
    const firstKept = await publish(site.payload, 'pages', { parent: firstSection.id, slug: 'kept-0', title: 'Kept 0' })
    const secondKept = await publish(site.payload, 'pages', { parent: secondSection.id, slug: 'kept-1', title: 'Kept 1' })

    const { docs, errors } = await site.payload.delete({
      collection: 'pages',
      overrideAccess: true,
      where: { id: { in: [landing.id, offer.id, firstSection.id, secondSection.id] } }
    })

    expect({ deleted: docs.length, errors }).toEqual({ deleted: 4, errors: [] })
    expect(await visit(site, '/kept-0')).toBe('document')
    expect(await visit(site, '/kept-1')).toBe('document')
    expect(await describeRedirects(site, ['/campaign/offer', '/section-0/kept-0', '/section-1/kept-1', '/offer'])).toEqual([
      { from: '/section-0/kept-0', status: 'suggested', to: targetOf('pages', firstKept) },
      { from: '/section-1/kept-1', status: 'suggested', to: targetOf('pages', secondKept) }
    ])
  })

  // A From of 700 such characters, 2,100 bytes in UTF-8, is refused, and the refused save of its
  // suggestion would fail the move.
  it('suggests none from an old path over 2,048 bytes, and moves the page', async () => {
    const longSlug = '漢'.repeat(700)
    const page = await publish(site.payload, 'pages', { slug: longSlug, title: 'Long' })

    expect((await publishChange(site.payload, 'pages', page, { slug: 'long-no-more' })).path).toBe('/long-no-more')
    expect(await describeRedirects(site, [`/${longSlug}`])).toEqual([])
  })

  it('writes and deletes the suggestions of a path that is not lowercase lowercased, as a from of a path is stored', async () => {
    const page = await publish(site.payload, 'pages', { slug: 'cased', title: 'Cased' })
    const req = await createPayloadRequest({ payload: site.payload })
    await createRedirect(site.payload, { from: '/now-here', status: 'suggested', to: toUrl('/elsewhere') })

    await suggestRedirects({
      changedPaths: [{ collection: 'pages', from: '/Was-Here', id: page.id, to: '/Now-Here' }],
      payload: site.payload,
      req
    })

    expect((await findRedirectsFrom(site, ['/was-here', '/now-here'])).map(({ from }) => from)).toEqual(['/was-here'])
  })

  // A bulk delete that deletes the parent first reports the grandchild where the last lift puts it, not
  // below where the first lift put the child. The order a bulk delete takes isn't set, so this report
  // is given whole.
  it('gives a document that moved elsewhere than below its moved ancestor a suggestion of its own', async () => {
    const child = await publish(site.payload, 'pages', { slug: 'lifted-child', title: 'Child' })
    const grandchild = await publish(site.payload, 'pages', { slug: 'lifted-grandchild', title: 'Grandchild' })
    const req = await createPayloadRequest({ payload: site.payload })

    await suggestRedirects({
      changedPaths: [
        { collection: 'pages', from: '/gone/c', id: child.id, to: '/lifted-child' },
        { collection: 'pages', from: '/gone/c/g', id: grandchild.id, to: '/lifted-grandchild' }
      ],
      payload: site.payload,
      req
    })
    await acceptSuggestions(site.payload, ['/gone/c', '/gone/c/g'])

    expect((await findRedirectsFrom(site, ['/gone/c', '/gone/c/g'])).map(({ from }) => from)).toEqual(['/gone/c', '/gone/c/g'])
    expect(await visit(site, '/gone/c/g')).toEqual(foundDocument('/lifted-grandchild'))
  })

  it('suggests one from / alone when the home page moves, since every path is below it', async () => {
    const home = await publish(site.payload, 'pages', { slug: 'home', title: 'Home' })

    await publishChange(site.payload, 'pages', home, { slug: 'start' })
    await acceptSuggestions(site.payload, ['/'])

    expect(await findRedirectsFrom(site, ['/'])).toEqual([expect.objectContaining({ from: '/', match: 'exact' })])
    expect(await visit(site, '/')).toEqual(foundDocument('/start'))
    expect(await visit(site, '/no-page-here')).toBeNull()
  })

  // A ? in an old path is part of the path, so the suggestion's From keeps it encoded, never as a
  // query string.
  it('suggests a redirect from an old path that holds a ?, which a visitor asks for decoded', async () => {
    const answers = await publish(site.payload, 'pages', { slug: 'answers', title: 'Answers' })
    const req = await createPayloadRequest({ payload: site.payload })

    await suggestRedirects({
      changedPaths: [{ collection: 'pages', from: '/faq?old', id: answers.id, to: '/answers' }],
      payload: site.payload,
      req
    })
    await acceptSuggestions(site.payload, ['/faq%3Fold'])

    expect(await describeRedirects(site, ['/faq%3Fold'])).toEqual([
      { from: '/faq%3Fold', status: 'on', to: targetOf('pages', answers) }
    ])
    expect(await visit(site, '/faq?old/how')).toEqual(foundDocument('/answers/how'))
  })

  it('deletes the suggestions to a deleted page, and keeps an editor’s redirect to it, which sends nobody', async () => {
    const page = await publish(site.payload, 'pages', { slug: 'gone-old', title: 'Gone' })
    await publishChange(site.payload, 'pages', page, { slug: 'gone-new' })
    await createRedirect(site.payload, { from: '/gone-link', to: toDocument('pages', page) })

    await remove(site.payload, 'pages', page)

    // Postgres and SQLite drop the relationship to a deleted row, so only the from and status are compared.
    expect((await findRedirectsFrom(site, ['/gone-old', '/gone-link'])).map(({ from, status }) => ({ from, status }))).toEqual([
      { from: '/gone-link', status: 'on' }
    ])
    expect(await visit(site, '/gone-link')).toBeNull()
  })

  it('keeps the suggestions to a page in the trash, and deletes them when it is deleted from there', async () => {
    const page = await publish(site.payload, 'pages', { slug: 'binned-old', title: 'Binned' })
    await publishChange(site.payload, 'pages', page, { slug: 'binned-new' })

    await site.payload.update({
      collection: 'pages',
      data: { deletedAt: new Date().toISOString() },
      id: page.id,
      overrideAccess: true
    })
    expect(await describeRedirects(site, ['/binned-old'])).toEqual([
      { from: '/binned-old', status: 'suggested', to: targetOf('pages', page) }
    ])

    await site.payload.delete({ collection: 'pages', id: page.id, overrideAccess: true, trash: true })
    expect(await describeRedirects(site, ['/binned-old'])).toEqual([])
  })

  it('deletes the suggestions to each page of a bulk delete', async () => {
    const first = await publish(site.payload, 'pages', { slug: 'cleared-a', title: 'Cleared A' })
    const second = await publish(site.payload, 'pages', { slug: 'cleared-b', title: 'Cleared B' })
    await publishChange(site.payload, 'pages', first, { slug: 'cleared-c' })
    await publishChange(site.payload, 'pages', second, { slug: 'cleared-d' })

    const { errors } = await site.payload.delete({
      collection: 'pages',
      overrideAccess: true,
      where: { id: { in: [first.id, second.id] } }
    })

    expect(errors).toEqual([])
    expect(await describeRedirects(site, ['/cleared-a', '/cleared-b'])).toEqual([])
  })

  it.runIf(setup.transactions)(
    "deletes a deleted page's suggestions in the delete's transaction, so a delete that fails keeps them",
    async () => {
      const page = await publish(site.payload, 'pages', { slug: 'kept-old', title: 'Kept' })
      await publishChange(site.payload, 'pages', page, { slug: 'kept-new' })
      const req = await createPayloadRequest({ payload: site.payload })
      await initTransaction(req)

      await site.payload.delete({ collection: 'pages', id: page.id, overrideAccess: true, req })
      await killTransaction(req)

      expect(await describeRedirects(site, ['/kept-old'])).toEqual([
        { from: '/kept-old', status: 'suggested', to: targetOf('pages', page) }
      ])
      expect(await visit(site, '/kept-new')).toBe('document')
    }
  )

  // Without transactions a failed save keeps what it wrote, as the docs say.
  it.runIf(setup.transactions)("writes its suggestions in the save's transaction, so a save that fails writes none", async () => {
    const press = await publish(site.payload, 'pages', { slug: 'press', title: 'Press' })
    const req = await createPayloadRequest({ payload: site.payload })
    await initTransaction(req)

    await publishChange(site.payload, 'pages', press, { slug: 'media' }, { req })
    await killTransaction(req)

    expect(await findRedirectsFrom(site, ['/press'])).toEqual([])
    expect(await visit(site, '/press')).toBe('document')
  })
})

describeSite('the redirects a move suggests, with localization', { localized: true }, (site) => {
  it('suggests one when a collection with one path in every locale reports its move in each locale', async () => {
    const recipe = await publish(site.payload, 'news', { slug: 'recipe', title: 'Recipe' }, { locale: 'en' })
    await publishChange(site.payload, 'news', recipe, { title: 'Recept' }, { locale: 'sv' })

    await publishChange(site.payload, 'news', recipe, { slug: 'recipes' }, { locale: 'en' })
    await acceptSuggestions(site.payload, ['/news/recipe'])

    expect(site.changes.at(-1)?.map(({ from, locale, to }) => [locale, from, to])).toEqual([
      ['en', '/news/recipe', '/news/recipes'],
      ['sv', '/news/recipe', '/news/recipes']
    ])
    expect((await findRedirectsFrom(site, ['/news/recipe'])).length).toBe(1)
    expect(await visit(site, '/news/recipe', 'sv')).toEqual(foundDocument('/news/recipes'))
  })

  it("suggests one from a locale's old path to the document's path in that locale", async () => {
    const about = await publish(site.payload, 'pages', { slug: 'about', title: 'About' }, { locale: 'en' })
    await publishChange(site.payload, 'pages', about, { slug: 'om', title: 'Om' }, { locale: 'sv' })

    await publishChange(site.payload, 'pages', about, { slug: 'om-oss' }, { locale: 'sv' })
    await acceptSuggestions(site.payload, ['/om'])

    expect(await visit(site, '/om', 'sv')).toEqual(foundDocument('/om-oss'))
    expect(await visit(site, '/about', 'en')).toBe('document')
  })
})

describeSite(
  'the redirects a move suggests, to some of the collections with a path',
  { redirects: { collections: ['pages'] } },
  (site) => {
    it("suggests none for a document of a collection a redirect can't send visitors to", async () => {
      const notice = await publish(site.payload, 'news', { slug: 'notice', title: 'Notice' })

      await publishChange(site.payload, 'news', notice, { slug: 'notices' })

      expect(await findRedirects(site.payload)).toEqual([])
    })

    it('deletes the suggestion from the path a document of such a collection is published at', async () => {
      const bulletin = await publish(site.payload, 'pages', { slug: 'bulletin', title: 'Bulletin' })
      await createRedirect(site.payload, {
        from: '/news/bulletin',
        match: 'below',
        status: 'suggested',
        to: toDocument('pages', bulletin)
      })

      await publish(site.payload, 'news', { slug: 'bulletin', title: 'Bulletin' })

      expect(await findRedirectsFrom(site, ['/news/bulletin'])).toEqual([])
    })

    // SQLite binds at most 32,766 values in one statement, which a change of tens of thousands would pass.
    it('reads the redirects at the paths of a change 1,000 paths at a time', async () => {
      const req = await createPayloadRequest({ payload: site.payload })
      const changedPaths = Array.from({ length: 2_001 }, (_, index) => ({
        collection: 'news',
        from: null,
        id: index + 1,
        to: `/news/published-${index}`
      }))

      const queries = await site.listQueries(() => suggestRedirects({ changedPaths, payload: site.payload, req }))

      expect(queries.filter(({ collection }) => collection === 'redirects')).toHaveLength(3)
    })
  }
)

const changedRedirects: string[] = []
const recordRedirect: CollectionAfterChangeHook = ({ doc }) => void changedRedirects.push(String(doc.from))

describeSite(
  'the redirects a move suggests, in a collection the site changed',
  {
    redirects: {
      overrides: (redirects) => ({
        ...redirects,
        hooks: { ...redirects.hooks, afterChange: [...(redirects.hooks?.afterChange ?? []), recordRedirect] },
        slug: 'old-links'
      })
    }
  },
  (site) => {
    it("keeps them in the site's collection and runs its hooks", async () => {
      // The site of each database records into the same list.
      changedRedirects.length = 0
      const shop = await publish(site.payload, 'pages', { slug: 'shop', title: 'Shop' })

      await publishChange(site.payload, 'pages', shop, { slug: 'store' })
      await acceptSuggestions(site.payload, ['/shop'], 'old-links')

      expect(changedRedirects).toEqual(['/shop', '/shop'])
      expect(await visit(site, '/shop/cart')).toEqual(foundDocument('/store/cart'))
    })
  }
)

// A hook of the site's own that moves another page, through the same request, when a suggestion from
// /kite is written, so suggestRedirects runs again from inside its own write.
const moveReedAfterKite: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create' || doc.from !== '/kite') return
  const { docs } = await req.payload.find({
    collection: 'pages',
    depth: 0,
    overrideAccess: true,
    req,
    where: { slug: { equals: 'reed' } }
  })
  await publishChange(req.payload, 'pages', docs[0]!, { slug: 'rush' }, { req })
}

describeSite(
  'the redirects a move suggests, in a collection whose hook moves another page',
  {
    redirects: {
      overrides: (redirects) => ({
        ...redirects,
        hooks: { ...redirects.hooks, afterChange: [...(redirects.hooks?.afterChange ?? []), moveReedAfterKite] }
      })
    }
  },
  (site) => {
    it('suggests one for each move, the one the hook makes too, and settles', { timeout: 15_000 }, async () => {
      const kite = await publish(site.payload, 'pages', { slug: 'kite', title: 'Kite' })
      const reed = await publish(site.payload, 'pages', { slug: 'reed', title: 'Reed' })

      await publishChange(site.payload, 'pages', kite, { slug: 'falcon' })

      expect(await describeRedirects(site, ['/kite', '/reed'])).toEqual([
        { from: '/kite', status: 'suggested', to: targetOf('pages', kite) },
        { from: '/reed', status: 'suggested', to: targetOf('pages', reed) }
      ])
    })
  }
)

// A rule of the site's own that keeps every redirect.
const refuseDelete: CollectionBeforeDeleteHook = () => {
  throw new APIError('This redirect is kept.', 400, null, true)
}

describeSite(
  'the redirects a move suggests, in a collection whose deletes the site refuses',
  {
    redirects: {
      overrides: (redirects) => ({
        ...redirects,
        hooks: { ...redirects.hooks, beforeDelete: [...(redirects.hooks?.beforeDelete ?? []), refuseDelete] }
      })
    }
  },
  (site) => {
    it('fails the save that moves a document with the refusal, rather than keep the suggestion it deletes', async () => {
      const kiosk = await publish(site.payload, 'pages', { slug: 'kiosk', title: 'Kiosk' })
      await publishChange(site.payload, 'pages', kiosk, { slug: 'stand' })

      // Back at /kiosk, the move deletes the suggestion from it.
      await expect(publishChange(site.payload, 'pages', kiosk, { slug: 'kiosk' })).rejects.toThrow('This redirect is kept.')
    })
  }
)

// The site's own rules: a redirect from a path that ends in -kept is never deleted, nor a page titled
// Stuck.
const refuseKeptRedirect: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const redirect = await req.payload.findByID({ collection: 'redirects', depth: 0, id, overrideAccess: true, req })
  if (String(redirect.from).endsWith('-kept')) throw new APIError('This redirect is kept.', 400, null, true)
}

const refuseStuckPage: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const page = await req.payload.findByID({ collection: 'pages', depth: 0, id, overrideAccess: true, req })
  if (page.title === 'Stuck') throw new APIError('This page is kept.', 400, null, true)
}

describeSite(
  'the suggestions a delete takes, on a site that keeps some redirects and pages from being deleted',
  {
    pages: { hooks: { beforeDelete: [refuseStuckPage] } },
    redirects: {
      overrides: (redirects) => ({
        ...redirects,
        hooks: { ...redirects.hooks, beforeDelete: [...(redirects.hooks?.beforeDelete ?? []), refuseKeptRedirect] }
      })
    }
  },
  (site) => {
    const describeSuggestions = async (froms: string[]) =>
      (await findRedirectsFrom(site, froms)).map(({ from, status }) => ({ from, status }))

    it('keeps every suggestion to a page whose delete fails, by id and through a where', async () => {
      const anchor = await publish(site.payload, 'pages', { slug: 'anchor', title: 'Stuck' })
      const buoy = await publish(site.payload, 'pages', { slug: 'buoy', title: 'Stuck' })
      await publishChange(site.payload, 'pages', anchor, { slug: 'mooring' })
      await publishChange(site.payload, 'pages', buoy, { slug: 'beacon' })

      await expect(remove(site.payload, 'pages', anchor)).rejects.toThrow('This page is kept.')
      const { docs, errors } = await site.payload.delete({
        collection: 'pages',
        overrideAccess: true,
        where: { id: { equals: buoy.id } }
      })

      expect({ deleted: docs.length, errors: errors.map(({ message }) => message) }).toEqual({
        deleted: 0,
        errors: ['This page is kept.']
      })
      expect(await describeSuggestions(['/anchor', '/buoy'])).toEqual([
        { from: '/anchor', status: 'suggested' },
        { from: '/buoy', status: 'suggested' }
      ])
    })

    // As the list view deletes, through a where, and as an edit view does, by id.
    it('deletes a page and its suggestions but one the site keeps, which stays without failing the delete', async () => {
      const lantern = await publish(site.payload, 'pages', { slug: 'lantern-kept', title: 'Lantern' })
      const torch = await publish(site.payload, 'pages', { slug: 'torch-kept', title: 'Torch' })
      for (const [page, slugs] of [
        [lantern, ['lantern-a', 'lantern']],
        [torch, ['torch-a', 'torch']]
      ] as const) {
        for (const slug of slugs) await publishChange(site.payload, 'pages', page, { slug })
      }

      await remove(site.payload, 'pages', lantern)
      const { docs, errors } = await site.payload.delete({
        collection: 'pages',
        overrideAccess: true,
        where: { id: { equals: torch.id } }
      })

      expect({ deleted: docs.length, errors }).toEqual({ deleted: 1, errors: [] })
      expect(await describeSuggestions(['/lantern-kept', '/lantern-a', '/torch-kept', '/torch-a'])).toEqual([
        { from: '/lantern-kept', status: 'suggested' },
        { from: '/torch-kept', status: 'suggested' }
      ])
    })
  }
)
