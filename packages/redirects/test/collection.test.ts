import type { PayloadRequest, TextField, TextFieldSingleValidation } from 'payload'
import { expect, it } from 'vitest'

import { buildDocumentKey } from '../src/fields/target-document-key.js'
import {
  BELOW_ROOT_REFUSAL,
  FROM_TOO_LONG_REFUSAL,
  FROM_WITHOUT_PATH_REFUSAL,
  REGEX_TOO_LARGE_REFUSAL,
  QUERY_STRING_REFUSAL,
  URL_REFUSAL
} from '../src/plugin/messages.js'
import { describeSite } from './support/boot-payload.js'
import {
  catchFieldErrors,
  createEditorRequest,
  createMemberRequest,
  createRedirect,
  findFoundRedirect,
  findRedirectByID,
  findRedirects,
  foundUrl,
  publish,
  publishChange,
  toDocument,
  toUrl,
  updateRedirect
} from './support/documents.js'

// A slash and then the count of characters given, drawn from the ones given so that no stretch
// repeats, which Postgres can't compress to fit an index, as a site's real paths are.
function buildUnrepeatedPath(characters: string[], count: number) {
  let seed = count
  return `/${Array.from({ length: count }, () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
    return characters[seed % characters.length]
  }).join('')}`
}

const LETTERS_AND_DIGITS = [...'abcdefghijklmnopqrstuvwxyz0123456789']

// Three bytes each in UTF-8.
const CJK_CHARACTERS = Array.from({ length: 3_000 }, (_, index) => String.fromCodePoint(0x4e00 + index))

describeSite('the redirects collection', {}, (site) => {
  it('trims a regex and keeps it as written, with its fixed start', async () => {
    const redirect = await createRedirect(site.payload, { from: '  ^/archive/(\\d+)/$  ', match: 'regex', to: toUrl('/a/$1') })
    const mixedCase = await createRedirect(site.payload, { from: '/Archiv/(.*)', match: 'regex', to: toUrl('/a/$1') })

    expect(await findRedirectByID(site.payload, redirect.id)).toMatchObject({
      from: '^/archive/(\\d+)/$',
      lookupPath: '/archive'
    })
    expect(await findRedirectByID(site.payload, mixedCase.id)).toMatchObject({ from: '/Archiv/(.*)', lookupPath: '/Archiv' })
  })

  it('keeps a query string as a redirect compares it, and a ? and # encoded in a path, through a save that sends them back', async () => {
    const froms = [
      { from: 'https://example.com/News.aspx?utm_source=mail&ID=123&cat=b&cat=a', storedFrom: '/news.aspx?cat=a&cat=b&id=123' },
      { from: '/FAQ%3Fold%23top', match: 'below' as const, storedFrom: '/faq%3Fold%23top' },
      { from: '/contact?subject=Hello%0AWorld%01', storedFrom: '/contact?subject=hello%0Aworld%01' }
    ]

    for (const { from, match, storedFrom } of froms) {
      const redirect = await createRedirect(site.payload, { from, match, to: toUrl('/faq') })
      await updateRedirect(site.payload, redirect.id, { from: (await findRedirectByID(site.payload, redirect.id)).from })

      expect((await findRedirectByID(site.payload, redirect.id)).from).toBe(storedFrom)
    }
  })

  it('takes a from of every path below a path whose query string holds only tracking parameters, without it', async () => {
    const redirect = await createRedirect(site.payload, { from: '/Tracked?utm_source=mail', match: 'below', to: toUrl('/a') })

    expect((await findRedirectByID(site.payload, redirect.id)).from).toBe('/tracked')
  })

  it('refuses a query string on Path and subpaths and on a regex, saying to pick Exact path', async () => {
    const refusedFroms = [
      { from: '/old-list?page=2', match: 'below' as const },
      { from: '/news\\.aspx\\?id=(\\d+)', match: 'regex' as const },
      { from: '/news.aspx?id=(\\d+)', match: 'regex' as const }
    ]

    for (const { from, match } of refusedFroms) {
      expect(await catchFieldErrors(createRedirect(site.payload, { from, match, to: toUrl('/a') }))).toEqual([
        expect.objectContaining({ message: QUERY_STRING_REFUSAL, path: 'from' })
      ])
    }
  })

  it('refuses a from that holds no path, with a message on the field', async () => {
    for (const from of ['//', 'https://']) {
      expect(await catchFieldErrors(createRedirect(site.payload, { from, to: toUrl('/a') }))).toEqual([
        expect.objectContaining({ message: FROM_WITHOUT_PATH_REFUSAL, path: 'from' })
      ])
    }
  })

  it('refuses every path below /, and takes / alone', async () => {
    expect(await catchFieldErrors(createRedirect(site.payload, { from: '/', match: 'below', to: toUrl('/a') }))).toEqual([
      expect.objectContaining({ message: BELOW_ROOT_REFUSAL, path: 'from' })
    ])
    expect((await createRedirect(site.payload, { from: '/', to: toUrl('/start') })).from).toBe('/')
  })

  it("refuses a regex RE2 can't run or that is too large, saying how to write it", async () => {
    const [unreadableRefusal] = await catchFieldErrors(
      createRedirect(site.payload, { from: '/(?=x)a', match: 'regex', to: toUrl('/a') })
    )
    const [tooLargeRefusal] = await catchFieldErrors(
      createRedirect(site.payload, { from: '/(?:a?){1000}b', match: 'regex', to: toUrl('/a') })
    )

    expect(unreadableRefusal).toEqual(expect.objectContaining({ path: 'from' }))
    expect(unreadableRefusal!.message).toContain("A regex can't look ahead or behind or refer back to a group")
    expect(tooLargeRefusal).toEqual(expect.objectContaining({ message: REGEX_TOO_LARGE_REFUSAL, path: 'from' }))
  })

  it('refuses a URL that is neither a path on this site nor a whole http(s) URL', async () => {
    for (const url of ['contact', '//other.example', 'ftp://example.com']) {
      expect(await catchFieldErrors(createRedirect(site.payload, { from: `/url-${url.length}`, to: toUrl(url) }))).toEqual([
        expect.objectContaining({ message: URL_REFUSAL, path: 'to.url' })
      ])
    }
  })

  // A lookup finds a redirect at it, so it follows every save that changes the from or the match.
  it('stores the lookup path through every save: the fixed start of a regex, and the From of any other', async () => {
    const redirect = await createRedirect(site.payload, { from: '/journal/(.*)', match: 'regex', to: toUrl('/j/$1') })
    expect(redirect.lookupPath).toBe('/journal')

    expect(await updateRedirect(site.payload, redirect.id, { from: '/Journal', match: 'exact' })).toMatchObject({
      from: '/journal',
      lookupPath: '/journal'
    })
    expect(await updateRedirect(site.payload, redirect.id, { match: 'below' })).toMatchObject({ lookupPath: '/journal' })
    expect(await updateRedirect(site.payload, redirect.id, { from: '/diary/(.*)', match: 'regex' })).toMatchObject({
      lookupPath: '/diary'
    })
    expect(await updateRedirect(site.payload, redirect.id, { from: '/Diary?Page=2', match: 'exact' })).toMatchObject({
      lookupPath: '/diary?page=2'
    })

    // As the admin saves the whole form back, a status changed alone, a reorder and a bulk update.
    const { from, match, status, to, type } = await findRedirectByID(site.payload, redirect.id)
    await updateRedirect(site.payload, redirect.id, { from, match, status, to, type })
    await updateRedirect(site.payload, redirect.id, { status: 'off' })
    await updateRedirect(site.payload, redirect.id, { _order: `${redirect._order}V` })
    await site.payload.update({
      collection: 'redirects',
      data: { status: 'on' } as never,
      overrideAccess: true,
      where: { id: { equals: redirect.id } }
    })
    expect(await findRedirectByID(site.payload, redirect.id)).toMatchObject({ lookupPath: '/diary?page=2' })

    const gazette = await publish(site.payload, 'pages', { slug: 'gazette', title: 'Gazette' })
    await publishChange(site.payload, 'pages', gazette, { slug: 'bulletin' })
    expect((await findRedirects(site.payload)).find(({ from: suggestedFrom }) => suggestedFrom === '/gazette')).toMatchObject({
      lookupPath: '/gazette'
    })
  })

  // A reorder and a status changed over REST or MCP send only the field they change.
  it('keeps a stored regex through a save that sends only some fields', async () => {
    const regex = '^/reports/(\\d{4})/$'
    const redirect = await createRedirect(site.payload, { from: regex, match: 'regex', to: toUrl('/r/$1') })

    await updateRedirect(site.payload, redirect.id, { status: 'off' })
    await updateRedirect(site.payload, redirect.id, { _order: `${redirect._order}V` })

    expect(await findRedirectByID(site.payload, redirect.id)).toMatchObject({ from: regex, lookupPath: '/reports' })
  })

  // Postgres's unique index on from holds at most 2,704 bytes a row, and a letter outside a to z
  // takes two or more.
  it('refuses a from over 2,048 bytes with a message on the field, and takes one of 2,048 that answers', async () => {
    const longestFroms = [buildUnrepeatedPath(LETTERS_AND_DIGITS, 2_047), buildUnrepeatedPath(CJK_CHARACTERS, 682)]

    for (const from of [buildUnrepeatedPath(LETTERS_AND_DIGITS, 2_048), buildUnrepeatedPath(CJK_CHARACTERS, 683)]) {
      expect(await catchFieldErrors(createRedirect(site.payload, { from, to: toUrl('/a') }))).toEqual([
        expect.objectContaining({ message: FROM_TOO_LONG_REFUSAL, path: 'from' })
      ])
    }
    for (const from of longestFroms) {
      expect((await createRedirect(site.payload, { from, to: toUrl('/longest') })).from).toBe(from)
      expect(await findFoundRedirect({ path: from, payload: site.payload })).toEqual(foundUrl('/longest'))
    }
  })

  // The admin validates what an editor typed, before any hook cleans it, as it builds the form's state.
  it('measures a from as it is stored, both as the admin validates what was typed and through a save', async () => {
    const russianUrl = `https://example.com/${encodeURIComponent(`${'п'.repeat(180)}-${'р'.repeat(180)}`)}`
    const trackedLink = `/spring-sale?utm_content=${'x'.repeat(2_120)}`
    const req = await createEditorRequest(site.payload)
    const fromField = site.payload.collections.redirects.config.fields.find(
      (field) => 'name' in field && field.name === 'from'
    ) as TextField
    const validateTyped = (value: string, match: string) =>
      (fromField.validate as TextFieldSingleValidation)(value, {
        data: {},
        req,
        required: true,
        siblingData: { match }
      } as unknown as Parameters<TextFieldSingleValidation>[1])

    expect([russianUrl, trackedLink].map((value) => new TextEncoder().encode(value).length > 2_048)).toEqual([true, true])
    expect(await validateTyped(russianUrl, 'exact')).toBe(true)
    expect(await validateTyped(trackedLink, 'exact')).toBe(true)
    expect(await validateTyped(`/news/(.*)${' '.repeat(2_050)}`, 'regex')).toBe(true)
    expect(await validateTyped(buildUnrepeatedPath(LETTERS_AND_DIGITS, 2_048), 'exact')).toBe(FROM_TOO_LONG_REFUSAL)
    expect((await createRedirect(site.payload, { from: russianUrl, to: toUrl('/russian') })).from).toBe(
      `/${'п'.repeat(180)}-${'р'.repeat(180)}`
    )
    expect((await createRedirect(site.payload, { from: trackedLink, to: toUrl('/sale') })).from).toBe('/spring-sale')
  })

  // Read by the notices and by a delete, which find a document's suggestions by it.
  it('stores the document key of a document target through every save, and none for a URL target', async () => {
    const shelf = await publish(site.payload, 'pages', { slug: 'shelf', title: 'Shelf' })
    const rack = await publish(site.payload, 'pages', { slug: 'rack', title: 'Rack' })
    const readKeys = async (...ids: (number | string)[]) =>
      Promise.all(ids.map(async (id) => (await findRedirectByID(site.payload, id)).targetDocumentKey))
    const redirect = await createRedirect(site.payload, { from: '/to-shelf', to: toDocument('pages', shelf) })
    const urlRedirect = await createRedirect(site.payload, { from: '/to-url', to: toUrl('/a') })
    expect(await readKeys(redirect.id, urlRedirect.id)).toEqual([buildDocumentKey('pages', shelf.id), null])

    // As the admin saves the whole form back.
    const { from, match, status, to, type } = await findRedirectByID(site.payload, redirect.id)
    await updateRedirect(site.payload, redirect.id, { from, match, status, to, type })
    expect(await readKeys(redirect.id)).toEqual([buildDocumentKey('pages', shelf.id)])

    await updateRedirect(site.payload, redirect.id, { status: 'off' })
    await updateRedirect(site.payload, redirect.id, { _order: `${redirect._order}V` })
    await site.payload.update({
      collection: 'redirects',
      data: { status: 'on' } as never,
      overrideAccess: true,
      where: { id: { in: [redirect.id, urlRedirect.id] } }
    })
    expect(await readKeys(redirect.id, urlRedirect.id)).toEqual([buildDocumentKey('pages', shelf.id), null])

    await updateRedirect(site.payload, redirect.id, { to: toDocument('pages', rack) })
    await updateRedirect(site.payload, urlRedirect.id, { to: toDocument('pages', shelf) })
    expect(await readKeys(redirect.id, urlRedirect.id)).toEqual([
      buildDocumentKey('pages', rack.id),
      buildDocumentKey('pages', shelf.id)
    ])

    await updateRedirect(site.payload, redirect.id, { to: toUrl('/b') })
    expect(await readKeys(redirect.id)).toEqual([null])

    await publishChange(site.payload, 'pages', rack, { slug: 'stand' })
    const [suggestion] = (await findRedirects(site.payload)).filter(({ from: suggestedFrom }) => suggestedFrom === '/rack')
    expect(suggestion?.targetDocumentKey).toBe(buildDocumentKey('pages', rack.id))
  })

  it('refuses a from another redirect has, in any case', async () => {
    await createRedirect(site.payload, { from: '/about', to: toUrl('/a') })

    expect(await catchFieldErrors(createRedirect(site.payload, { from: '/About', to: toUrl('/b') }))).toEqual([
      expect.objectContaining({ path: 'from' })
    ])
  })

  it('lets anyone read the redirects that are on, also a user of another collection, and a user of the admin every one', async () => {
    const onRedirect = await createRedirect(site.payload, { from: '/read-on', to: toUrl('/a') })
    const offRedirect = await createRedirect(site.payload, { from: '/read-off', status: 'off', to: toUrl('/a') })
    const suggestion = await createRedirect(site.payload, { from: '/read-suggested', status: 'suggested', to: toUrl('/a') })
    const findReadIds = async (req?: PayloadRequest) => {
      const { docs } = await site.payload.find({
        collection: 'redirects',
        overrideAccess: false,
        pagination: false,
        req,
        where: { from: { in: ['/read-on', '/read-off', '/read-suggested'] } }
      })
      return docs.map(({ id }) => id).sort()
    }

    expect(await findReadIds()).toEqual([onRedirect.id])
    expect(await findReadIds(await createMemberRequest(site.payload))).toEqual([onRedirect.id])
    expect(await findReadIds(await createEditorRequest(site.payload))).toEqual(
      [onRedirect.id, offRedirect.id, suggestion.id].sort()
    )
  })

  // Who made a redirect is the admin's business, as the redirects that are off are.
  it('shows who created and last saved a redirect only to a user of the admin', async () => {
    const editorRequest = await createEditorRequest(site.payload)
    const redirect = await site.payload.create({
      collection: 'redirects',
      data: { from: '/authored', to: toUrl('/a') } as never,
      overrideAccess: true,
      req: editorRequest
    })
    const findAuthorship = async (req?: PayloadRequest) => {
      const document = await site.payload.findByID({
        collection: 'redirects',
        depth: 0,
        id: redirect.id,
        overrideAccess: false,
        req
      })
      return { createdBy: document.createdBy, updatedBy: document.updatedBy }
    }
    const editor = { relationTo: 'users', value: editorRequest.user!.id }

    expect(await findAuthorship()).toEqual({ createdBy: undefined, updatedBy: undefined })
    expect(await findAuthorship(await createMemberRequest(site.payload))).toEqual({ createdBy: undefined, updatedBy: undefined })
    expect(await findAuthorship(editorRequest)).toEqual({ createdBy: editor, updatedBy: editor })
  })
})
