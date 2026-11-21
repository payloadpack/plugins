import type { Access, CollectionAfterReadHook, JsonObject } from 'payload'
import { generateKeyBetween } from 'payload/shared'
import { describe, expect, it } from 'vitest'

import type { BuildDocumentPath } from '../src/index.js'
import { describeSite } from './support/boot-payload.js'
import {
  createDraft,
  createEditorRequest,
  createRedirect,
  findFoundRedirect,
  foundDocument,
  foundUrl,
  publish,
  publishChange,
  remove,
  toDocument,
  toUrl,
  updateRedirect
} from './support/documents.js'

describeSite('findRedirect', {}, (site) => {
  it('answers a permanent redirect as permanent and a temporary one as not', async () => {
    const contact = await publish(site.payload, 'pages', { slug: 'contact-us', title: 'Contact' })
    const openingHours = await publish(site.payload, 'news', { slug: 'opening-hours', title: 'Opening hours' })
    await createRedirect(site.payload, { from: 'https://example.com/kontakt-oss/', to: toDocument('pages', contact) })
    await createRedirect(site.payload, { from: '/öppettider', to: toDocument('news', openingHours), type: 'temporary' })

    expect(await findFoundRedirect({ path: '/kontakt-oss', payload: site.payload })).toEqual(foundDocument('/contact-us'))
    expect(await findFoundRedirect({ path: '/öppettider', payload: site.payload })).toEqual(
      foundDocument('/news/opening-hours', { permanent: false })
    )
  })

  it('sends a redirect to a document wherever the document moves', async () => {
    const prices = await publish(site.payload, 'pages', { slug: 'prices', title: 'Prices' })
    await createRedirect(site.payload, { from: '/pricing', to: toDocument('pages', prices) })
    expect(await findFoundRedirect({ path: '/pricing', payload: site.payload })).toEqual(foundDocument('/prices'))

    await publishChange(site.payload, 'pages', prices, { slug: 'tariffs' })

    expect(await findFoundRedirect({ path: '/pricing', payload: site.payload })).toEqual(foundDocument('/tariffs'))
  })

  it("never follows a redirect that is off or suggested, also on a signed-in user's request, who may read it", async () => {
    await createRedirect(site.payload, { from: '/signed-in-off', status: 'off', to: toUrl('/a') })
    await createRedirect(site.payload, { from: '/signed-in-suggested', match: 'below', status: 'suggested', to: toUrl('/b') })
    const req = await createEditorRequest(site.payload)

    expect(await findFoundRedirect({ path: '/signed-in-off', payload: site.payload, req })).toBeNull()
    expect(await findFoundRedirect({ path: '/signed-in-suggested/below', payload: site.payload, req })).toBeNull()
    expect(await findFoundRedirect({ path: '/signed-in-suggested', payload: site.payload })).toBeNull()
  })

  it('sends every path below a path to the same place below its target', async () => {
    await createRedirect(site.payload, { from: '/old-shop', match: 'below', to: toUrl('https://shop.example') })

    expect(await findFoundRedirect({ path: '/old-shop', payload: site.payload })).toEqual(foundUrl('https://shop.example/'))
    expect(await findFoundRedirect({ path: '/old-shop/cart/42', payload: site.payload })).toEqual(
      foundUrl('https://shop.example/cart/42')
    )
    expect(await findFoundRedirect({ path: '/old-shopping', payload: site.payload })).toBeNull()
  })

  it('takes an exact redirect only at its own path', async () => {
    await createRedirect(site.payload, { from: '/exact-only', to: toUrl('/somewhere') })

    expect(await findFoundRedirect({ path: '/exact-only/below', payload: site.payload })).toBeNull()
  })

  it('takes the deepest redirect that covers a path', async () => {
    await createRedirect(site.payload, { from: '/deep', match: 'below', to: toUrl('/shallow-target') })
    await createRedirect(site.payload, { from: '/deep/er', match: 'below', to: toUrl('/deeper-target') })

    expect(await findFoundRedirect({ path: '/deep/er/still', payload: site.payload })).toEqual(foundUrl('/deeper-target/still'))
    expect(await findFoundRedirect({ path: '/deep/other', payload: site.payload })).toEqual(foundUrl('/shallow-target/other'))
  })

  it('falls through a redirect whose target sends nobody: a draft, a document in the trash or one deleted', async () => {
    const draftPage = await createDraft(site.payload, 'pages', { slug: 'unpublished', title: 'Unpublished' })
    const trashedPage = await publish(site.payload, 'pages', { slug: 'trashed', title: 'Trashed' })
    const deletedPage = await publish(site.payload, 'pages', { slug: 'deleted', title: 'Deleted' })
    await createRedirect(site.payload, { from: '/sale', match: 'below', to: toUrl('/fallback') })
    for (const [slug, target] of [
      ['draft', draftPage],
      ['trashed', trashedPage],
      ['deleted', deletedPage]
    ] as const) {
      await createRedirect(site.payload, { from: `/sale/${slug}`, to: toDocument('pages', target) })
    }
    await site.payload.update({
      collection: 'pages',
      data: { deletedAt: new Date().toISOString() },
      id: trashedPage.id,
      overrideAccess: true
    })
    await remove(site.payload, 'pages', deletedPage)

    expect(await findFoundRedirect({ path: '/sale/draft', payload: site.payload })).toEqual(foundUrl('/fallback/draft'))
    expect(await findFoundRedirect({ path: '/sale/trashed', payload: site.payload })).toEqual(foundUrl('/fallback/trashed'))
    expect(await findFoundRedirect({ path: '/sale/deleted', payload: site.payload })).toEqual(foundUrl('/fallback/deleted'))
  })

  it('answers none where no redirect covers a path', async () => {
    expect(await findFoundRedirect({ path: '/nothing/here', payload: site.payload })).toBeNull()
    expect(await findFoundRedirect({ path: '/', payload: site.payload })).toBeNull()
  })

  it('fills in the groups a regex captured, on a long path too', async () => {
    await createRedirect(site.payload, { from: '^/archive/(.*)$', match: 'regex', to: toUrl('/journal/$1') })
    const longSlug = 'a'.repeat(500)

    expect(await findFoundRedirect({ path: '/archive/2019/summer', payload: site.payload })).toEqual(
      foundUrl('/journal/2019/summer')
    )
    expect(await findFoundRedirect({ path: `/archive/${longSlug}`, payload: site.payload })).toEqual(
      foundUrl(`/journal/${longSlug}`)
    )
  })

  it('finds a regex that starts with a group, through /', async () => {
    await createRedirect(site.payload, { from: '/(\\d{4})/report-(.*)', match: 'regex', to: toUrl('/reports/$1/$2') })

    expect(await findFoundRedirect({ path: '/2019/report-summer', payload: site.payload })).toEqual(
      foundUrl('/reports/2019/summer')
    )
  })

  // A backtracking engine gives the same answers, after far longer than a visitor waits.
  it('answers a hostile regex with the right answer, within a second', async () => {
    await createRedirect(site.payload, { from: '^/(a+)+$', match: 'regex', to: toUrl('/hostile') })

    const startedAt = performance.now()
    expect(await findFoundRedirect({ path: `/${'a'.repeat(30)}!`, payload: site.payload })).toBeNull()
    expect(await findFoundRedirect({ path: `/${'a'.repeat(30)}`, payload: site.payload })).toEqual(foundUrl('/hostile'))
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })

  it('takes a redirect from a path over a regex, and the first regex in the list, which a drag flips', async () => {
    const firstRegex = await createRedirect(site.payload, { from: '^/order/(.*)$', match: 'regex', to: toUrl('/first/$1') })
    await createRedirect(site.payload, { from: '^/order/(.+)$', match: 'regex', to: toUrl('/second/$1') })
    await createRedirect(site.payload, { from: '/order/exact', to: toUrl('/exact') })
    expect(await findFoundRedirect({ path: '/order/exact', payload: site.payload })).toEqual(foundUrl('/exact'))
    expect(await findFoundRedirect({ path: '/order/a', payload: site.payload })).toEqual(foundUrl('/first/a'))

    // What the reorder endpoint saves when an editor drags the first regex below every other.
    const [lastRedirect] = (await site.payload.find({ collection: 'redirects', limit: 1, overrideAccess: true, sort: '-_order' }))
      .docs
    await updateRedirect(site.payload, firstRegex.id, { _order: generateKeyBetween(String(lastRedirect!._order), null) })

    expect(await findFoundRedirect({ path: '/order/a', payload: site.payload })).toEqual(foundUrl('/second/a'))
  })

  it('gives no redirect to a path over 2,048 characters, and finds one at 2,048', async () => {
    await createRedirect(site.payload, { from: '/long', match: 'below', to: toUrl('/l') })
    const longestPath = `/long/${'b'.repeat(2_048 - '/long/'.length)}`

    expect(await findFoundRedirect({ path: longestPath, payload: site.payload })).not.toBeNull()
    expect(await findFoundRedirect({ path: `${longestPath}b`, payload: site.payload })).toBeNull()
  })

  it('gives no redirect to a path over 32 segments, and finds one at 32', async () => {
    await createRedirect(site.payload, { from: '/deep-segments', match: 'below', to: toUrl('/d') })
    const longestPath = `/deep-segments${'/s'.repeat(31)}`

    expect(longestPath.split('/')).toHaveLength(33)
    expect(await findFoundRedirect({ path: longestPath, payload: site.payload })).toEqual(foundUrl(`/d${'/s'.repeat(31)}`))
    expect(await findFoundRedirect({ path: `${longestPath}/s`, payload: site.payload })).toBeNull()
  })

  it('matches Path and subpaths in any case, and keeps the rest of the path as typed for a URL', async () => {
    await createRedirect(site.payload, { from: '/Old-Store', match: 'below', to: toUrl('https://shop.example') })
    await createRedirect(site.payload, { from: '/Rates', to: toUrl('/prices') })
    // İ lowercases to two characters, so the rest of the path is cut by segments, not by length.
    await createRedirect(site.payload, { from: '/İzmir', match: 'below', to: toUrl('https://izmir.example') })

    expect(await findFoundRedirect({ path: '/old-store/Cart/42', payload: site.payload })).toEqual(
      foundUrl('https://shop.example/Cart/42')
    )
    expect(await findFoundRedirect({ path: '/OLD-STORE', payload: site.payload })).toEqual(foundUrl('https://shop.example/'))
    expect(await findFoundRedirect({ path: '/rAtEs', payload: site.payload })).toEqual(foundUrl('/prices'))
    expect(await findFoundRedirect({ path: '/İzmir/Team', payload: site.payload })).toEqual(
      foundUrl('https://izmir.example/Team')
    )
  })

  it('answers a decoded path that holds a ? or # with the redirect from it, never as a query string', async () => {
    await createRedirect(site.payload, { from: '/FAQ%3Fold', to: toUrl('/faq') })
    await createRedirect(site.payload, { from: '/notes%23draft', match: 'below', to: toUrl('/notes') })

    expect(await findFoundRedirect({ path: '/faq?old', payload: site.payload })).toEqual(foundUrl('/faq'))
    expect(await findFoundRedirect({ path: '/Notes#draft/2024', payload: site.payload })).toEqual(foundUrl('/notes/2024'))
    expect(await findFoundRedirect({ path: '/faq', payload: site.payload, searchParams: new URLSearchParams('old') })).toBeNull()
  })

  // As a site with Next's trailingSlash asks for every path.
  it('drops the slash at the end of a path asked for, as a From drops it', async () => {
    await createRedirect(site.payload, { from: '/brochures', to: toUrl('/leaflets') })
    await createRedirect(site.payload, { from: '/brochures?id=4', to: toUrl('/leaflet-4') })
    await createRedirect(site.payload, { from: '/handbook', match: 'below', to: toUrl('/guide') })
    await createRedirect(site.payload, { from: '/manuals/(.*)', match: 'regex', to: toUrl('/docs/$1') })

    expect(await findFoundRedirect({ path: '/brochures/', payload: site.payload })).toEqual(foundUrl('/leaflets'))
    expect(await findFoundRedirect({ path: '/brochures/', payload: site.payload, searchParams: { id: '4' } })).toEqual(
      foundUrl('/leaflet-4', { matchedQueryString: true })
    )
    expect(await findFoundRedirect({ path: '/handbook/setup/', payload: site.payload })).toEqual(foundUrl('/guide/setup'))
    expect(await findFoundRedirect({ path: '/manuals/setup/', payload: site.payload })).toEqual(foundUrl('/docs/setup'))
  })

  it('carries the rest of the path over lowercased to a document, whose path is lowercase', async () => {
    const company = await publish(site.payload, 'pages', { slug: 'firm', title: 'Firm' })
    await createRedirect(site.payload, { from: '/Old-Firm', match: 'below', to: toDocument('pages', company) })

    expect(await findFoundRedirect({ path: '/OLD-FIRM/Team/Anna', payload: site.payload })).toEqual(
      foundDocument('/firm/team/anna')
    )
  })

  it('matches a regex as written, and in any case when it starts with (?i)', async () => {
    await createRedirect(site.payload, { from: '/Catalogue/(.*)', match: 'regex', to: toUrl('/c/$1') })
    await createRedirect(site.payload, { from: '(?i)/brochure/(.*)', match: 'regex', to: toUrl('/b/$1') })

    expect(await findFoundRedirect({ path: '/Catalogue/Spring', payload: site.payload })).toEqual(foundUrl('/c/Spring'))
    expect(await findFoundRedirect({ path: '/catalogue/spring', payload: site.payload })).toBeNull()
    expect(await findFoundRedirect({ path: '/BROCHURE/Spring', payload: site.payload })).toEqual(foundUrl('/b/Spring'))
  })

  describe('with a query string', () => {
    it('matches a redirect from Exact path and a query string in any order and case, beside tracking parameters', async () => {
      const openingHours = await publish(site.payload, 'news', { slug: 'hours', title: 'Hours' })
      await createRedirect(site.payload, { from: '/news.aspx?id=123&cat=a', to: toDocument('news', openingHours) })
      const matchedRedirect = foundDocument('/news/hours', { matchedQueryString: true })

      expect(
        await findFoundRedirect({ path: '/news.aspx', payload: site.payload, searchParams: new URLSearchParams('cat=a&id=123') })
      ).toEqual(matchedRedirect)
      expect(
        await findFoundRedirect({ path: '/NEWS.aspx', payload: site.payload, searchParams: new URLSearchParams('ID=123&CAT=A') })
      ).toEqual(matchedRedirect)
      expect(
        await findFoundRedirect({ path: '/news.aspx', payload: site.payload, searchParams: { cat: 'a', id: '123' } })
      ).toEqual(matchedRedirect)
      expect(
        await findFoundRedirect({
          path: '/news.aspx',
          payload: site.payload,
          searchParams: new URLSearchParams('id=123&cat=a&utm_source=mail')
        })
      ).toEqual(foundDocument('/news/hours?utm_source=mail', { matchedQueryString: true }))
      expect(
        await findFoundRedirect({ path: '/news.aspx', payload: site.payload, searchParams: new URLSearchParams('id=123') })
      ).toBeNull()
      expect(
        await findFoundRedirect({
          path: '/news.aspx',
          payload: site.payload,
          searchParams: new URLSearchParams('id=123&cat=a&page=2')
        })
      ).toBeNull()
      expect(await findFoundRedirect({ path: '/news.aspx', payload: site.payload })).toBeNull()
    })

    it('takes a redirect that matched the query string over one from the path, from a path above it and a regex', async () => {
      await createRedirect(site.payload, { from: '/catalog/(.*)', match: 'regex', to: toUrl('/regex') })
      await createRedirect(site.payload, { from: '/catalog', match: 'below', to: toUrl('/above') })
      await createRedirect(site.payload, { from: '/catalog/item', to: toUrl('/path') })
      await createRedirect(site.payload, { from: '/catalog/item?sku=9', to: toUrl('/query') })

      expect(await findFoundRedirect({ path: '/catalog/item', payload: site.payload, searchParams: { sku: '9' } })).toEqual(
        foundUrl('/query', { matchedQueryString: true })
      )
      expect(await findFoundRedirect({ path: '/catalog/item', payload: site.payload, searchParams: { sku: '8' } })).toEqual(
        foundUrl('/path?sku=8')
      )
    })

    it("keeps the visitor's query string on every redirect, the target's value winning where both have a parameter", async () => {
      const prices = await publish(site.payload, 'pages', { slug: 'fees', title: 'Fees' })
      await createRedirect(site.payload, { from: '/costs', to: toDocument('pages', prices) })
      await createRedirect(site.payload, { from: '/old-form', to: toUrl('/form?ref=old#top') })
      await createRedirect(site.payload, { from: '/old-docs/(.*)', match: 'regex', to: toUrl('https://docs.example/$1') })

      expect(
        await findFoundRedirect({
          path: '/costs',
          payload: site.payload,
          searchParams: new URLSearchParams('utm_source=mail&tab=2')
        })
      ).toEqual(foundDocument('/fees?utm_source=mail&tab=2'))
      expect(
        await findFoundRedirect({ path: '/old-form', payload: site.payload, searchParams: new URLSearchParams('ref=new&step=1') })
      ).toEqual(foundUrl('/form?ref=old&step=1#top'))
      expect(await findFoundRedirect({ path: '/old-docs/setup', payload: site.payload, searchParams: { q: 'a b' } })).toEqual(
        foundUrl('https://docs.example/setup?q=a+b')
      )
    })

    it('matches a query string that holds a control character, a NUL too', async () => {
      await createRedirect(site.payload, { from: '/enquiry?subject=Hello%0AWorld', to: toUrl('/enquiries') })
      await createRedirect(site.payload, { from: '/blank?id=%00', to: toUrl('/blanks') })

      expect(
        await findFoundRedirect({
          path: '/enquiry',
          payload: site.payload,
          searchParams: new URLSearchParams('subject=Hello%0AWorld')
        })
      ).toEqual(foundUrl('/enquiries', { matchedQueryString: true }))
      expect(
        await findFoundRedirect({ path: '/blank', payload: site.payload, searchParams: new URLSearchParams('id=%00') })
      ).toEqual(foundUrl('/blanks', { matchedQueryString: true }))
    })

    it('falls through a redirect from a query string whose target sends nobody', async () => {
      const draftPage = await createDraft(site.payload, 'pages', { slug: 'draft-offer', title: 'Draft' })
      await createRedirect(site.payload, { from: '/offer?code=x', to: toDocument('pages', draftPage) })
      await createRedirect(site.payload, { from: '/offer', to: toUrl('/offers') })

      expect(await findFoundRedirect({ path: '/offer', payload: site.payload, searchParams: { code: 'x' } })).toEqual(
        foundUrl('/offers?code=x')
      )
    })
  })

  it('keeps a target on its own site, whatever a visitor fills in', async () => {
    await createRedirect(site.payload, { from: '/go/(.*)', match: 'regex', to: toUrl('/$1') })
    await createRedirect(site.payload, { from: '/below-home', match: 'below', to: toUrl('/') })

    expect(await findFoundRedirect({ path: '/go//other.example', payload: site.payload })).toBeNull()
    expect(await findFoundRedirect({ path: '/below-home//other.example', payload: site.payload })).toBeNull()
  })

  it('encodes the path of a document target', async () => {
    const greeting = await publish(site.payload, 'pages', { slug: 'мир', title: 'Мир' })
    await createRedirect(site.payload, { from: '/привет', to: toDocument('pages', greeting) })

    expect(await findFoundRedirect({ path: '/привет', payload: site.payload })).toEqual(foundDocument('/%D0%BC%D0%B8%D1%80'))
  })
})

describeSite('findRedirect with localization', { localized: true }, (site) => {
  it("sends visitors to the document's path in the locale asked for", async () => {
    const about = await publish(site.payload, 'pages', { slug: 'about', title: 'About' }, { locale: 'en' })
    await publishChange(site.payload, 'pages', about, { slug: 'om-oss', title: 'Om oss' }, { locale: 'sv' })
    await createRedirect(site.payload, { from: '/who-we-are', to: toDocument('pages', about) })

    expect(await findFoundRedirect({ locale: 'en', path: '/who-we-are', payload: site.payload })).toEqual(foundDocument('/about'))
    expect(await findFoundRedirect({ locale: 'sv', path: '/who-we-are', payload: site.payload })).toEqual(
      foundDocument('/om-oss')
    )
  })
})

describeSite('findRedirect with tracking parameters of the site', { redirects: { trackingParameters: ['ref_src'] } }, (site) => {
  it('never compares the tracking parameters the site adds, and keeps them in the destination', async () => {
    await createRedirect(site.payload, { from: '/story?id=7&ref_src=feed', to: toUrl('/stories/7') })

    expect(
      await findFoundRedirect({ path: '/story', payload: site.payload, searchParams: { id: '7', ref_src: 'mail' } })
    ).toEqual(foundUrl('/stories/7?ref_src=mail', { matchedQueryString: true }))
  })
})

// A site that builds its documents' paths itself, from a field of its own: buildDocumentPath answers
// with the title of the document the lookup read, so a test writes the path it wants into the title.
// It is async, as a site's may be, and keeps the document it was given last.
let documentBuiltFrom: JsonObject | undefined
const buildTitleAsPath: BuildDocumentPath = async ({ document }) => {
  documentBuiltFrom = document
  return document.title
}

const ownPaths = {
  buildDocumentPath: buildTitleAsPath,
  collections: ['pages' as const],
  documentSelect: { title: true as const }
}

describeSite("findRedirect with the site's own buildDocumentPath", { redirects: ownPaths }, (site) => {
  it('sends visitors to the path it builds, with the rest of the path below and the query string', async () => {
    const shop = await publish(site.payload, 'pages', { slug: 'butik', title: '/shop' })
    await createRedirect(site.payload, { from: '/store', match: 'below', to: toDocument('pages', shop) })

    expect(await findFoundRedirect({ path: '/store/Cart', payload: site.payload, searchParams: { ref: 'mail' } })).toEqual(
      foundDocument('/shop/cart?ref=mail')
    )
  })

  it('builds from only the fields documentSelect names', async () => {
    const shop = await publish(site.payload, 'pages', { slug: 'winkel', title: '/winkel' })
    await createRedirect(site.payload, { from: '/old-shop', to: toDocument('pages', shop) })

    await findFoundRedirect({ path: '/old-shop', payload: site.payload })
    expect(documentBuiltFrom).toMatchObject({ title: '/winkel' })
    expect(documentBuiltFrom).not.toHaveProperty('slug')
  })

  it('falls through a document it builds no path for, or one off this site', async () => {
    const titlesByAnswer = {
      absolute: 'https://elsewhere.example/sale',
      none: '',
      'off-site': '//elsewhere.example/sale',
      relative: 'sale'
    }
    await createRedirect(site.payload, { from: '/gone', match: 'below', to: toUrl('/fallback') })
    for (const [answer, title] of Object.entries(titlesByAnswer)) {
      const page = await publish(site.payload, 'pages', { slug: `gone-${answer}`, title })
      await createRedirect(site.payload, { from: `/gone/${answer}`, to: toDocument('pages', page) })
    }

    for (const answer of Object.keys(titlesByAnswer)) {
      expect(await findFoundRedirect({ path: `/gone/${answer}`, payload: site.payload })).toEqual(foundUrl(`/fallback/${answer}`))
    }
  })

  it('builds from a document only as the request findRedirect is given reads it', async () => {
    const draftPage = await createDraft(site.payload, 'pages', { slug: 'coming-soon', title: '/coming-soon' })
    await createRedirect(site.payload, { from: '/soon', to: toDocument('pages', draftPage) })
    const req = await createEditorRequest(site.payload)

    expect(await findFoundRedirect({ path: '/soon', payload: site.payload })).toBeNull()
    expect(await findFoundRedirect({ path: '/soon', payload: site.payload, req })).toEqual(foundDocument('/coming-soon'))
  })
})

describeSite(
  "findRedirect with the site's own buildDocumentPath and no documentSelect",
  { redirects: { ...ownPaths, documentSelect: undefined } },
  (site) => {
    it('builds from the whole document', async () => {
      const shop = await publish(site.payload, 'pages', { slug: 'butik', title: '/shop' })
      await createRedirect(site.payload, { from: '/store', to: toDocument('pages', shop) })

      await findFoundRedirect({ path: '/store', payload: site.payload })
      expect(documentBuiltFrom).toMatchObject({ slug: 'butik', title: '/shop' })
    })
  }
)

describeSite(
  "findRedirect with the site's own buildDocumentPath and localization",
  { localized: true, redirects: ownPaths },
  (site) => {
    it('builds the path from the document in the locale findRedirect is given', async () => {
      const about = await publish(site.payload, 'pages', { slug: 'about', title: '/en/about' }, { locale: 'en' })
      await publishChange(site.payload, 'pages', about, { title: '/sv/om-oss' }, { locale: 'sv' })
      await createRedirect(site.payload, { from: '/who-we-are', to: toDocument('pages', about) })

      expect(await findFoundRedirect({ locale: 'sv', path: '/who-we-are', payload: site.payload })).toEqual(
        foundDocument('/sv/om-oss')
      )
    })
  }
)

// Each read's collection and the cache tag its context carries, as a site's own hook sees them.
const seenReads: { cacheTag: unknown; collection: string }[] = []
const recordRead: CollectionAfterReadHook = ({ collection, context }) =>
  void seenReads.push({ cacheTag: context.cacheTag, collection: collection.slug })

describeSite(
  'findRedirect with a context',
  {
    pages: { hooks: { afterRead: [recordRead] } },
    redirects: {
      overrides: (redirects) => ({
        ...redirects,
        hooks: { ...redirects.hooks, afterRead: [...(redirects.hooks?.afterRead ?? []), recordRead] }
      })
    }
  },
  (site) => {
    it("passes it on to the lookup and to the read of the document target, so the site's hooks see it", async () => {
      const page = await publish(site.payload, 'pages', { slug: 'tagged', title: 'Tagged' })
      await createRedirect(site.payload, { from: '/to-tagged', to: toDocument('pages', page) })
      seenReads.length = 0

      await findFoundRedirect({ context: { cacheTag: 'redirects' }, path: '/to-tagged', payload: site.payload })

      expect(seenReads).toEqual([
        { cacheTag: 'redirects', collection: 'redirects' },
        { cacheTag: 'redirects', collection: 'pages' }
      ])
    })
  }
)

// A site whose visitors read only the permanent redirects.
const readPermanentOrSignedIn: Access = ({ req: { user } }) =>
  Boolean(user) || { status: { equals: 'on' }, type: { equals: 'permanent' } }

describeSite(
  "findRedirect with the site's own read access",
  { redirects: { overrides: (redirects) => ({ ...redirects, access: { ...redirects.access, read: readPermanentOrSignedIn } }) } },
  (site) => {
    it('follows only the redirects the request it is given can read', async () => {
      await createRedirect(site.payload, { from: '/campaign-only', to: toUrl('/spring'), type: 'temporary' })
      const req = await createEditorRequest(site.payload)

      expect(await findFoundRedirect({ path: '/campaign-only', payload: site.payload })).toBeNull()
      expect(await findFoundRedirect({ path: '/campaign-only', payload: site.payload, req })).toEqual(
        foundUrl('/spring', { permanent: false })
      )
    })
  }
)
