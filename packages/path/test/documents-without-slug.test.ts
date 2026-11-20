import type { Payload } from 'payload'
import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import {
  catchFieldErrors,
  create,
  readDocument,
  readLatestVersion,
  readPath,
  readRows,
  store,
  update
} from './support/documents.js'
import { SETUPS } from './support/setups.js'

const MISSING_SLUG = [{ message: 'Give this document a slug, or a title to make one from.', path: 'slug' }]

// Guides have a title that isn't localized, beside the slug, which a localized setup has one of per locale.
const GUIDES = { collections: [titled('guides', false)], options: { collections: ['pages', 'posts', 'notices', 'guides'] } }

// As the admin does the moment an editor opens "Create new" in a collection with autosave.
const createEmpty = (payload: Payload) =>
  payload.create({ collection: 'pages', data: {}, depth: 0, draft: true, overrideAccess: true })

describeEachSetup('', { boot: GUIDES }, (test, setup) => {
  it('creates a draft without a slug, which has no path yet, beside another one', async () => {
    const { payload } = test
    const [first, second] = [await createEmpty(payload), await createEmpty(payload)]

    for (const { id } of [first, second]) {
      expect(await readDocument(payload, 'pages', id, { draft: true })).toMatchObject({ ancestors: [], id })
      expect((await readDocument(payload, 'pages', id, { draft: true })).slug ?? null).toBeNull()
      expect((await readDocument(payload, 'pages', id, { draft: true })).path ?? null).toBeNull()
      expect((await readDocument(payload, 'pages', id)).path ?? null).toBeNull()
    }
  })

  it('gives a draft a slug from its title and a path in the autosave that gives it a title, and keeps the slug after that', async () => {
    const { payload } = test
    const { id } = await createEmpty(payload)

    const titled = await update(payload, 'pages', id, { title: 'Opening hours' }, { autosave: true, draft: true })

    expect(titled).toMatchObject({ path: '/opening-hours', slug: 'opening-hours' })
    expect(await findByPath({ draft: true, path: '/opening-hours', payload })).toMatchObject({ document: { id } })
    // A page that isn't published is where its latest draft says, so the page itself has the path too.
    expect(await readDocument(payload, 'pages', id)).toMatchObject({ path: '/opening-hours' })

    const retitled = await update(payload, 'pages', id, { title: 'Hours' }, { autosave: true, draft: true })
    const published = await update(payload, 'pages', id, { title: 'Our hours' })

    expect(retitled).toMatchObject({ path: '/opening-hours', slug: 'opening-hours' })
    expect(published).toMatchObject({ path: '/opening-hours', slug: 'opening-hours' })
  })

  it('refuses to publish a document without a slug and without a title', async () => {
    const { payload } = test
    const { id } = await createEmpty(payload)

    expect(await catchFieldErrors(update(payload, 'pages', id, {}))).toMatchObject(MISSING_SLUG)
    expect((await readDocument(payload, 'pages', id, { draft: true }))._status).toBe('draft')
  })

  it('refuses a new document of a collection without drafts that has neither a slug nor a title', async () => {
    expect(await catchFieldErrors(create(test.payload, 'notices', {}))).toMatchObject(MISSING_SLUG)
  })

  it('takes a sent slug that cleans to nothing for no slug, and makes one from the title', async () => {
    const { payload } = test
    const bang = await create(payload, 'pages', { slug: '!!!', title: 'Bang' })
    const slash = await create(payload, 'notices', { slug: '/', title: 'Slash' })

    expect(bang).toMatchObject({ path: '/bang', slug: 'bang' })
    expect(slash).toMatchObject({ path: '/slash', slug: 'slash' })
    expect(await catchFieldErrors(create(payload, 'pages', { slug: '!!!' }))).toMatchObject(MISSING_SLUG)
    expect(await catchFieldErrors(create(payload, 'notices', { slug: '/', title: '?' }))).toMatchObject(MISSING_SLUG)
  })

  it('keeps the slug when a save sends one that cleans to nothing', async () => {
    const { payload } = test
    const kept = await create(payload, 'pages', { slug: 'kept', title: 'Kept' })

    const saved = await update(payload, 'pages', kept.id, { slug: '???' })

    expect(saved).toMatchObject({ path: '/kept', slug: 'kept' })
  })

  if (setup.localized) {
    // Each locale's slug in the latest version. MongoDB leaves a locale without one out.
    const readSlugs = async (id: Id) => {
      const slugs = (await readLatestVersion(test.payload, 'pages', id)).slug as Record<string, unknown>
      return { en: slugs.en ?? null, sv: slugs.sv ?? null }
    }

    it('gives an empty draft first given a title in Swedish its slug from that title', async () => {
      const { payload } = test
      const { id } = await createEmpty(payload)

      const titled = await update(payload, 'pages', id, { title: 'Öppettider' }, { autosave: true, draft: true, locale: 'sv' })

      expect(titled).toMatchObject({ path: '/oppettider', slug: 'oppettider' })
      expect(await readSlugs(id)).toEqual({ en: null, sv: 'oppettider' })
    })

    it('keeps the path a locale falls back to when a page with an English slug is first saved in Swedish with a Swedish title', async () => {
      const { payload } = test
      const contact = await create(payload, 'pages', { slug: 'contact', title: 'Contact' })

      const draft = await update(
        payload,
        'pages',
        contact.id,
        { title: 'Kontakt' },
        { autosave: true, draft: true, locale: 'sv' }
      )
      const published = await update(payload, 'pages', contact.id, { title: 'Kontakta oss' }, { locale: 'sv' })

      expect([draft.path, published.path]).toEqual(['/contact', '/contact'])
      expect(await readSlugs(contact.id)).toEqual({ en: 'contact', sv: null })
      expect(await findByPath({ locale: 'sv', path: '/contact', payload })).toMatchObject({ document: { id: contact.id } })
    })

    it('falls back in a locale that is sent a slug that cleans to nothing, with drafts and without', async () => {
      const { payload } = test
      const visit = await create(payload, 'pages', { slug: 'visit', title: 'Visit' })
      const closed = await create(payload, 'notices', { slug: 'closed', title: 'Closed' })

      const page = await update(payload, 'pages', visit.id, { slug: '!!!', title: 'Besök' }, { locale: 'sv' })
      const notice = await update(payload, 'notices', closed.id, { slug: '/', title: 'Stängt' }, { locale: 'sv' })

      expect(page.path).toBe('/visit')
      expect(await readSlugs(visit.id)).toEqual({ en: 'visit', sv: null })
      // Without drafts a locale has a path only with a slug of its own, so it keeps the one it falls back to.
      expect(notice).toMatchObject({ path: '/closed', slug: 'closed' })
    })

    it('gives a new document sent such a slug in Swedish its slug from the Swedish title', async () => {
      const created = await test.payload.create({
        collection: 'pages',
        data: { _status: 'published', slug: '/', title: 'Öppet hus' },
        locale: 'sv',
        overrideAccess: true
      })

      expect(created).toMatchObject({ path: '/oppet-hus', slug: 'oppet-hus' })
    })

    it("gives each locale its slug from a title that isn't localized, in a save of every locale at once", async () => {
      const created = await test.payload.create({
        collection: 'guides',
        data: { _status: 'published', title: 'Getting started' },
        locale: 'all',
        overrideAccess: true
      })

      const inBoth = (value: string) => ({ en: value, sv: value })
      expect(created).toMatchObject({ path: inBoth('/getting-started'), slug: inBoth('getting-started') })
    })
  }

  it('leaves the documents below a renamed page that have no path as they were, while a page beside them moves', async () => {
    const { payload } = test
    const reception = await create(payload, 'pages', { slug: 'reception', title: 'Reception' })
    const desk = await create(payload, 'pages', { parent: reception.id, slug: 'desk', title: 'Desk' })
    const { id: draft } = await payload.create({
      collection: 'pages',
      data: { parent: reception.id },
      draft: true,
      overrideAccess: true
    })
    // Stored through the database adapter without a slug and without a path field at all, which an
    // update pipeline on MongoDB would give an empty object of locales.
    const stored = await store(test, setup, 'pages', { ancestors: [reception.id], parent: reception.id, title: 'Untitled' })
    const before = await readRows(payload, 'pages', [draft, stored])
    expect(before.documents).toMatchObject([{ ancestors: [reception.id] }, { ancestors: [reception.id] }])

    await update(payload, 'pages', reception.id, { slug: 'front-desk' })

    expect(await readPath(payload, 'pages', desk.id)).toBe('/front-desk/desk')
    expect(await readRows(payload, 'pages', [draft, stored])).toEqual(before)
  })

  it('refuses a document without a path as a parent, until it has one', async () => {
    const { payload } = test
    const { id } = await createEmpty(payload)
    const below = { parent: id, slug: 'below', title: 'Below' }

    expect(await catchFieldErrors(create(payload, 'pages', below, { draft: true }))).toMatchObject([
      { message: 'The parent has no path yet, so save the parent first.', path: 'parent' }
    ])

    await update(payload, 'pages', id, { title: 'Above' }, { autosave: true, draft: true })

    expect((await create(payload, 'pages', below, { draft: true })).path).toBe('/above/below')
  })
})

// In a localized collection a stored document may fall back to another locale's slug, so the hook
// before the write reads the stored slugs before it refuses a publish without one. The refusal comes
// before the write, so the document is left as it was, also in a bulk update, where Payload commits
// the other documents in the same transaction, and without transactions.
for (const transactions of [true, false]) {
  describeEachSetup(
    `a publish without a slug, transactions ${transactions ? 'on' : 'off'}`,
    { boot: { transactions }, setups: SETUPS.filter(({ localized }) => localized) },
    (test) => {
      it('refuses to publish a draft without a slug and without a title in a bulk update, and leaves it as it was', async () => {
        const { payload } = test
        const empty = await createEmpty(payload)
        const before = await readRows(payload, 'pages', [empty.id])

        const { errors } = await payload.update({
          collection: 'pages',
          data: { _status: 'published' },
          draft: true,
          overrideAccess: true,
          where: { id: { in: [empty.id] } }
        })

        // A bulk update lists a refusal by its ValidationError's message only.
        expect(errors).toMatchObject([{ id: empty.id, message: 'The following field is invalid: slug' }])
        expect(await readRows(payload, 'pages', [empty.id])).toEqual(before)
      })

      it('refuses to publish a draft without a slug and without a title, and leaves it as it was', async () => {
        const { payload } = test
        const empty = await createEmpty(payload)
        const before = await readRows(payload, 'pages', [empty.id])

        expect(await catchFieldErrors(update(payload, 'pages', empty.id, {}))).toMatchObject([
          { message: 'Give this document a slug, or a title to make one from.' }
        ])
        expect(await readRows(payload, 'pages', [empty.id])).toEqual(before)
      })
    }
  )
}
