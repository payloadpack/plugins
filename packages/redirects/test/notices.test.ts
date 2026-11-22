import { createPayloadRequest } from 'payload'
import { expect, it } from 'vitest'

import { suggestionNotice } from '../src/plugin/messages.js'
import { suggestionsEndpoint } from '../src/plugin/suggestions-endpoint.js'
import { describeSite, type Site } from './support/boot-payload.js'
import {
  acceptSuggestions,
  buildSuggestionsRequest,
  createEditorRequest,
  findRedirects,
  publish,
  publishChange,
  toUrl,
  updateRedirect
} from './support/documents.js'

type Options = { locale?: string; signedIn?: boolean }

async function findNotices(
  { payload }: Site,
  collection: string,
  id: number | string,
  { locale, signedIn = true }: Options = {}
) {
  const request = buildSuggestionsRequest(collection, { id }, locale)
  const req = signedIn ? await createEditorRequest(payload, request) : await createPayloadRequest({ payload, req: request })
  const response = await suggestionsEndpoint.handler(req)
  return ((await response.json()) as { notices: { text: string }[] }).notices.map(({ text }) => text)
}

describeSite('the notices of the redirects a move suggests', {}, (site) => {
  it('shows one for each suggestion to the moved document, with the path it is at now', async () => {
    const canal = await publish(site.payload, 'pages', { slug: 'canal', title: 'Canal' })
    await publishChange(site.payload, 'pages', canal, { slug: 'river' })
    await publishChange(site.payload, 'pages', canal, { slug: 'stream' })

    expect(await findNotices(site, 'pages', canal.id)).toEqual([
      'This page moved from /canal to /stream. Should visitors who ask for /canal be sent here?',
      'This page moved from /river to /stream. Should visitors who ask for /river be sent here?'
    ])
  })

  it('names a document by its collection’s label, lowercased', async () => {
    const fair = await publish(site.payload, 'news', { slug: 'fair', title: 'Fair' })

    await publishChange(site.payload, 'news', fair, { slug: 'market' })

    expect(await findNotices(site, 'news', fair.id)).toEqual([suggestionNotice('news', '/news/fair', '/news/market')])
  })

  it('shows none once someone said yes, and none on a document no move suggests a redirect to', async () => {
    const meadow = await publish(site.payload, 'pages', { slug: 'meadow', title: 'Meadow' })
    const field = await publish(site.payload, 'pages', { slug: 'field', title: 'Field' })
    await publishChange(site.payload, 'pages', meadow, { slug: 'pasture' })
    expect(await findNotices(site, 'pages', meadow.id)).toHaveLength(1)

    await acceptSuggestions(site.payload, ['/meadow'])

    expect(await findNotices(site, 'pages', meadow.id)).toEqual([])
    expect(await findNotices(site, 'pages', field.id)).toEqual([])
  })

  it('shows none to a visitor, who reads no suggestion', async () => {
    const orchard = await publish(site.payload, 'pages', { slug: 'orchard', title: 'Orchard' })

    await publishChange(site.payload, 'pages', orchard, { slug: 'grove' })

    expect(await findNotices(site, 'pages', orchard.id, { signedIn: false })).toEqual([])
    expect(await findNotices(site, 'pages', orchard.id)).toHaveLength(1)
  })

  // The suggestion keeps the document it was written with, which Yes would no longer send visitors to.
  it('shows none for a suggestion an editor gave a URL target', async () => {
    const dock = await publish(site.payload, 'pages', { slug: 'dock', title: 'Dock' })
    await publishChange(site.payload, 'pages', dock, { slug: 'pier' })
    const suggestion = (await findRedirects(site.payload)).find(({ from }) => from === '/dock')!

    await updateRedirect(site.payload, suggestion.id, { to: toUrl('/campaign') })

    expect(await findNotices(site, 'pages', dock.id)).toEqual([])
  })

  // Anyone can ask the endpoint for any id, which Postgres and SQLite refuse to compare.
  it('shows none to a visitor who asks with an id that is no id, without an error', async () => {
    expect(await findNotices(site, 'pages', 'null', { signedIn: false })).toEqual([])
  })

  it('shows the path of the document as the editor reads it, drafts included', async () => {
    const pond = await publish(site.payload, 'pages', { slug: 'pond', title: 'Pond' })
    await publishChange(site.payload, 'pages', pond, { slug: 'lake' })

    await site.payload.update({ collection: 'pages', data: { slug: 'lagoon' }, draft: true, id: pond.id, overrideAccess: true })

    expect(await findNotices(site, 'pages', pond.id)).toEqual([suggestionNotice('page', '/pond', '/lagoon')])
  })

  it('shows none for a collection a redirect can’t send visitors to', async () => {
    const { user } = await createEditorRequest(site.payload)

    expect(await findNotices(site, 'users', user!.id)).toEqual([])
  })
})

describeSite('the notices of the redirects a move suggests, with localization', { localized: true }, (site) => {
  it("shows the document's path in the editor's locale", async () => {
    const about = await publish(site.payload, 'pages', { slug: 'about', title: 'About' }, { locale: 'en' })
    await publishChange(site.payload, 'pages', about, { slug: 'om', title: 'Om' }, { locale: 'sv' })

    await publishChange(site.payload, 'pages', about, { slug: 'om-oss' }, { locale: 'sv' })

    expect(await findNotices(site, 'pages', about.id, { locale: 'sv' })).toEqual([suggestionNotice('page', '/om', '/om-oss')])
    expect(await findNotices(site, 'pages', about.id, { locale: 'en' })).toEqual([suggestionNotice('page', '/om', '/about')])
  })
})

describeSite(
  'the notices of the redirects a move suggests, when the site builds no path',
  { redirects: { buildDocumentPath: () => null, collections: ['pages'] } },
  (site) => {
    it('leaves out where the document is now', async () => {
      const cellar = await publish(site.payload, 'pages', { slug: 'cellar', title: 'Cellar' })

      await publishChange(site.payload, 'pages', cellar, { slug: 'vault' })

      expect(await findNotices(site, 'pages', cellar.id)).toEqual([
        'This page moved from /cellar. Should visitors who ask for /cellar be sent here?'
      ])
    })
  }
)

describeSite(
  'the notices of the redirects a move suggests, for a collection whose label is not a plain string',
  { pages: { labels: { plural: { en: 'Articles' }, singular: { en: 'Article' } } } },
  (site) => {
    it('names its document a page', async () => {
      const attic = await publish(site.payload, 'pages', { slug: 'attic', title: 'Attic' })

      await publishChange(site.payload, 'pages', attic, { slug: 'loft' })

      expect(await findNotices(site, 'pages', attic.id)).toEqual([suggestionNotice('page', '/attic', '/loft')])
    })
  }
)
