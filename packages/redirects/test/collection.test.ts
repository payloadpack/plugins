import { createPayloadRequest, type PayloadRequest } from 'payload'
import { expect, it } from 'vitest'

import {
  BELOW_ROOT_REFUSAL,
  FROM_WITHOUT_PATH_REFUSAL,
  REGEX_TOO_LARGE_REFUSAL,
  QUERY_STRING_REFUSAL,
  URL_REFUSAL
} from '../src/plugin/messages.js'
import { describeSite } from './support/boot-payload.js'
import {
  catchFieldErrors,
  createEditorRequest,
  createRedirect,
  findRedirectByID,
  toUrl,
  updateRedirect
} from './support/documents.js'

describeSite('the redirects collection', {}, (site) => {
  it('trims a regex and keeps it as written, with its fixed start', async () => {
    const redirect = await createRedirect(site.payload, { from: '  ^/archive/(\\d+)/$  ', match: 'regex', to: toUrl('/a/$1') })
    const mixedCase = await createRedirect(site.payload, { from: '/Archiv/(.*)', match: 'regex', to: toUrl('/a/$1') })

    expect(await findRedirectByID(site.payload, redirect.id)).toMatchObject({ from: '^/archive/(\\d+)/$', regexPath: '/archive' })
    expect(await findRedirectByID(site.payload, mixedCase.id)).toMatchObject({ from: '/Archiv/(.*)', regexPath: '/Archiv' })
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

  it('sets the fixed start on every save, and none for a redirect from a path', async () => {
    const redirect = await createRedirect(site.payload, { from: '/journal/(.*)', match: 'regex', to: toUrl('/j/$1') })
    expect(redirect.regexPath).toBe('/journal')

    const exactRedirect = await updateRedirect(site.payload, redirect.id, { from: '/journal', match: 'exact' })

    expect(exactRedirect).toMatchObject({ from: '/journal', regexPath: null })
  })

  // A reorder and a status changed over REST or MCP send only the field they change.
  it('keeps a stored regex through a save that sends only some fields', async () => {
    const regex = '^/reports/(\\d{4})/$'
    const redirect = await createRedirect(site.payload, { from: regex, match: 'regex', to: toUrl('/r/$1') })

    await updateRedirect(site.payload, redirect.id, { status: 'off' })
    await updateRedirect(site.payload, redirect.id, { _order: `${redirect._order}V` })

    expect(await findRedirectByID(site.payload, redirect.id)).toMatchObject({ from: regex, regexPath: '/reports' })
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

    const member = await site.payload.create({
      collection: 'members',
      data: { email: 'member@example.com', password: 'member' },
      overrideAccess: true
    })
    const memberRequest = await createPayloadRequest({ payload: site.payload, user: { ...member, collection: 'members' } })

    expect(await findReadIds()).toEqual([onRedirect.id])
    expect(await findReadIds(memberRequest)).toEqual([onRedirect.id])
    expect(await findReadIds(await createEditorRequest(site.payload))).toEqual(
      [onRedirect.id, offRedirect.id, suggestion.id].sort()
    )
  })
})
