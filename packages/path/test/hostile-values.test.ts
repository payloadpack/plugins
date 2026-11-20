import type { Slugify } from 'payload/shared'
import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, remove, store, update } from './support/documents.js'

// What a statement could take for its own: both quotes, the end of a statement, a comment, a
// parameter and an escape. A database must store each as the text it is.
const HOSTILE = `it's "x"; -- $1 \\`

const BASE_PATH = `/${HOSTILE}`
const LOCALE = `sv ${HOSTILE}`
const idOf = (name: string) => `${name} ${HOSTILE}`

const takenAt = (document: string, where: string) => [
  { message: `${document} is already at ${where}, so change the slug or the parent.`, path: 'slug' }
]

describeEachSetup(
  'with values that look like SQL',
  {
    boot: (setup) => ({
      // Labels and stickers take the ids they are given, so an id holds whatever a site makes it from.
      collections: ['labels', 'stickers'].map((slug) => titled(slug, setup.localized, [{ name: 'id', type: 'text' }])),
      localization: setup.localized ? { defaultLocale: 'en', fallback: true, locales: ['en', LOCALE] } : undefined,
      options: {
        collections: ['pages', { basePath: BASE_PATH, slug: 'labels' }, { basePath: `${BASE_PATH}/rack`, slug: 'stickers' }],
        rootSlug: `home ${HOSTILE}`
      }
    })
  },
  (test, setup) => {
    const label = (name: string, data: Record<string, unknown> = {}) =>
      create(test.payload, 'labels', { id: idOf(name), slug: name, title: name, ...data })

    it('saves a document under such an id, base path, root slug and locale, and finds it at its path', async () => {
      const { payload } = test
      const shelf = await label('shelf')
      const box = await label('box', { parent: shelf.id, slug: 'box--one' })
      const page = await create(payload, 'pages', { slug: 'plain', title: 'Plain' })

      expect(shelf.id).toBe(idOf('shelf'))
      expect(await readPath(payload, 'labels', shelf.id)).toBe(`${BASE_PATH}/shelf`)
      expect(await readPath(payload, 'labels', box.id)).toBe(`${BASE_PATH}/shelf/box--one`)
      expect((await readDocument(payload, 'labels', box.id)).ancestors).toEqual([idOf('shelf')])
      // No slug can hold the root slug, so a top-level page keeps its own path.
      expect(await readPath(payload, 'pages', page.id)).toBe('/plain')
      expect(await findByPath({ path: `${BASE_PATH}/shelf/box--one`, payload })).toMatchObject({
        collection: 'labels',
        document: { id: idOf('box') }
      })
      if (setup.localized) {
        await update(payload, 'labels', box.id, { slug: 'lada', title: 'Låda' }, { locale: LOCALE })

        expect(await readPath(payload, 'labels', box.id, { locale: LOCALE })).toBe(`${BASE_PATH}/shelf/lada`)
        expect(await readPath(payload, 'labels', box.id, { locale: 'en' })).toBe(`${BASE_PATH}/shelf/box--one`)
      }
    })

    it('moves a branch on a publish, to a new slug and to a new parent', async () => {
      const { payload } = test
      const crate = await label('crate')
      const lid = await label('lid', { parent: crate.id })
      const hinge = await label('hinge', { parent: lid.id })
      const cart = await label('cart')
      await update(payload, 'labels', hinge.id, { slug: 'hinge--pending' }, { draft: true })

      await update(payload, 'labels', crate.id, { slug: 'chest' })

      expect(await readPath(payload, 'labels', lid.id)).toBe(`${BASE_PATH}/chest/lid`)
      expect(await readPath(payload, 'labels', hinge.id)).toBe(`${BASE_PATH}/chest/lid/hinge`)
      expect(await readPath(payload, 'labels', hinge.id, { draft: true })).toBe(`${BASE_PATH}/chest/lid/hinge--pending`)

      await update(payload, 'labels', lid.id, { parent: cart.id })

      expect(await readPath(payload, 'labels', hinge.id)).toBe(`${BASE_PATH}/cart/lid/hinge`)
      expect(await readPath(payload, 'labels', hinge.id, { draft: true })).toBe(`${BASE_PATH}/cart/lid/hinge--pending`)
      expect((await readDocument(payload, 'labels', hinge.id)).ancestors).toEqual([idOf('cart'), idOf('lid')])
      expect((await readDocument(payload, 'labels', hinge.id, { draft: true })).ancestors).toEqual([idOf('cart'), idOf('lid')])
      if (setup.localized) {
        expect(await readPath(payload, 'labels', hinge.id, { locale: LOCALE })).toBe(`${BASE_PATH}/cart/lid/hinge`)
      }
    })

    it('lifts the documents below a deleted document, under its parent and to the top level', async () => {
      const { payload } = test
      const drawer = await label('drawer')
      const tray = await label('tray', { parent: drawer.id })
      const spoon = await label('spoon', { parent: tray.id })
      const tip = await label('tip', { parent: spoon.id })

      await remove(payload, 'labels', tray.id)

      expect(await readPath(payload, 'labels', spoon.id)).toBe(`${BASE_PATH}/drawer/spoon`)
      expect(await readPath(payload, 'labels', tip.id)).toBe(`${BASE_PATH}/drawer/spoon/tip`)
      expect((await readDocument(payload, 'labels', spoon.id)).parent).toBe(idOf('drawer'))
      expect((await readDocument(payload, 'labels', tip.id)).ancestors).toEqual([idOf('drawer'), idOf('spoon')])

      await remove(payload, 'labels', drawer.id)

      expect(await readPath(payload, 'labels', tip.id)).toBe(`${BASE_PATH}/spoon/tip`)
      expect((await readDocument(payload, 'labels', spoon.id)).parent).toBeFalsy()
      expect((await readDocument(payload, 'labels', tip.id, { draft: true })).ancestors).toEqual([idOf('spoon')])
    })

    it('refuses a save, a move and a lift onto a path that a document with such an id is at', async () => {
      const { payload } = test
      await label('jar')
      await create(payload, 'stickers', { id: idOf('sticker'), slug: 'hook', title: 'Sticker' })
      const stand = await label('stand')
      const hook = await label('hook', { parent: stand.id })
      await label('top-hook', { slug: 'hook' })

      expect(await catchFieldErrors(label('second-jar', { slug: 'jar' }))).toMatchObject(takenAt('Label "jar"', 'this path'))
      // The stickers' base path holds no document of its own, so only the branch lands on one.
      expect(await catchFieldErrors(update(payload, 'labels', stand.id, { slug: 'rack' }))).toMatchObject(
        takenAt('Sticker "Sticker"', `${BASE_PATH}/rack/hook`)
      )
      expect(await catchFieldErrors(remove(payload, 'labels', stand.id))).toMatchObject(
        takenAt('Label "top-hook"', `${BASE_PATH}/hook`)
      )
      expect(await readPath(payload, 'labels', hook.id)).toBe(`${BASE_PATH}/stand/hook`)
      expect((await readDocument(payload, 'labels', hook.id)).ancestors).toEqual([idOf('stand')])
    })
  }
)

// A site's own slugify that keeps a slug as it is typed, so a slug can hold the two characters a
// pattern of SQL matches other text with, and a letter outside the basic plane, which JavaScript
// counts as two characters and each database as one.
const slugifyAsTyped: Slugify = ({ valueToSlugify }) => (typeof valueToSlugify === 'string' ? valueToSlugify : undefined)

describeEachSetup(
  'with slugs that a pattern or a count of characters could take for others',
  { boot: { options: { slugify: slugifyAsTyped } } },
  (test, setup) => {
    it('gives the documents below a renamed document their new paths', async () => {
      const { payload } = test
      const sale = await create(payload, 'pages', { slug: '50%_off', title: 'Sale' })
      const deal = await create(payload, 'pages', { parent: sale.id, slug: 'deal_𐐷', title: 'Deal' })
      const coupon = await create(payload, 'pages', { parent: deal.id, slug: '100%', title: 'Coupon' })
      // Stored at the path the second rename gives it, which /50%_off/ as a pattern matches and as text
      // doesn't, so the rename leaves it as it is.
      const path = '/50_off/ticket'
      const ticket = await store(test, setup, 'pages', {
        ancestors: [sale.id],
        parent: sale.id,
        path: setup.localized ? { en: path, sv: path } : path,
        slug: 'ticket',
        title: 'Ticket'
      })

      await update(payload, 'pages', deal.id, { slug: 'deal_𐐷𐐷' })
      await update(payload, 'pages', sale.id, { slug: '50_off' })

      for (const draft of [false, true]) {
        expect(await readPath(payload, 'pages', deal.id, { draft })).toBe('/50_off/deal_𐐷𐐷')
        expect(await readPath(payload, 'pages', coupon.id, { draft })).toBe('/50_off/deal_𐐷𐐷/100%')
        expect(await readPath(payload, 'pages', ticket, { draft })).toBe(path)
      }
    })
  }
)
