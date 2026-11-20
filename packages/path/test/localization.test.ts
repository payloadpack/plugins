import type { CollectionSlug, Payload } from 'payload'
import { beforeEach, expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup } from './support/boot-payload.js'
import {
  catchFieldErrors,
  create,
  readDocument,
  readLatestVersion,
  readPath,
  remove,
  restoreVersion,
  store,
  update
} from './support/documents.js'
import { SETUPS } from './support/setups.js'

const LOCALIZED_SETUPS = SETUPS.filter(({ localized }) => localized)

const inSwedish = { locale: 'sv' }

// Read from the database, where Payload's own fallback can't fill a locale in.
const readStoredPaths = async (payload: Payload, collection: CollectionSlug, id: Id) =>
  (await payload.db.findOne<{ id: Id; path: unknown }>({ collection, where: { id: { equals: id } } }))?.path

describeEachSetup('', { setups: LOCALIZED_SETUPS }, (test, setup) => {
  beforeEach(() => {
    test.changes.length = 0
  })

  it("gives each locale a path from its own slug, or from the slug it falls back to, and moves only a locale's own branch", async () => {
    const { payload } = test
    const about = await create(payload, 'pages', { slug: 'about', title: 'About' })
    const team = await create(payload, 'pages', { parent: about.id, slug: 'team', title: 'Team' })
    expect(await readPath(payload, 'pages', team.id, inSwedish)).toBe('/about/team')

    const saved = await update(payload, 'pages', about.id, { slug: 'om-oss', title: 'Om oss' }, inSwedish)

    expect(saved.path).toBe('/om-oss')
    expect(await readPath(payload, 'pages', about.id)).toBe('/about')
    expect(await readPath(payload, 'pages', about.id, inSwedish)).toBe('/om-oss')
    expect(await readPath(payload, 'pages', team.id)).toBe('/about/team')
    expect(await readPath(payload, 'pages', team.id, inSwedish)).toBe('/om-oss/team')
    const stored = await payload.db.findOne<{ id: Id; path: unknown }>({
      collection: 'pages',
      where: { id: { equals: team.id } }
    })
    expect(stored?.path).toEqual({ en: '/about/team', sv: '/om-oss/team' })
  })

  it('moves the branch when every locale is published after an autosave, as the admin publishes', async () => {
    const { payload } = test
    const kitchen = await create(payload, 'pages', { slug: 'kitchen', title: 'Kitchen' })
    const knives = await create(payload, 'pages', { parent: kitchen.id, slug: 'knives', title: 'Knives' })
    await update(payload, 'pages', kitchen.id, { slug: 'kok' }, { autosave: true, draft: true, locale: 'sv' })

    await payload.update({
      collection: 'pages',
      data: { _status: 'published', slug: 'kok' },
      id: kitchen.id,
      locale: 'sv',
      overrideAccess: true,
      publishAllLocales: true
    })

    expect(await readPath(payload, 'pages', knives.id, inSwedish)).toBe('/kok/knives')
    expect(await readPath(payload, 'pages', knives.id)).toBe('/kitchen/knives')
  })

  it('refuses a path another document is at in the same locale, as a draft too, and accepts it in another locale', async () => {
    const { payload } = test
    const contact = await create(payload, 'pages', { slug: 'contact', title: 'Contact' })
    const reachUs = await create(payload, 'pages', { slug: 'reach-us', title: 'Reach us' })
    const refusal = [
      { locale: 'sv', message: 'Page "Contact" is already at this path, so change the slug or the parent.', path: 'slug' }
    ]

    // Contact isn't published in Swedish, and takes its Swedish path all the same.
    expect(await catchFieldErrors(update(payload, 'pages', reachUs.id, { slug: 'contact' }, inSwedish))).toMatchObject(refusal)
    expect(
      await catchFieldErrors(update(payload, 'pages', reachUs.id, { slug: 'contact' }, { draft: true, locale: 'sv' }))
    ).toMatchObject(refusal)

    await update(payload, 'pages', contact.id, { slug: 'kontakt' }, { draft: true, locale: 'sv' })
    await update(payload, 'pages', reachUs.id, { slug: 'contact' }, inSwedish)

    expect(await readStoredPaths(payload, 'pages', contact.id)).toEqual({ en: '/contact', sv: '/kontakt' })
    expect(await readStoredPaths(payload, 'pages', reachUs.id)).toEqual({ en: '/reach-us', sv: '/contact' })
  })

  it('checks the locales whose path follows the saved slug, and names the locale of a path in use', async () => {
    const { payload } = test
    const shop = await create(payload, 'pages', { slug: 'shop', title: 'Shop' })
    await update(payload, 'pages', shop.id, { slug: 'butik' }, inSwedish)
    const store = await create(payload, 'pages', { slug: 'store', title: 'Store' })
    await update(payload, 'pages', store.id, {}, inSwedish)

    // Store has no Swedish slug, so renaming it in English moves its Swedish path onto Shop's.
    expect(await catchFieldErrors(update(payload, 'pages', store.id, { slug: 'butik' }))).toMatchObject([
      { locale: 'sv', message: 'Page "Shop" is already at /butik in sv, so change the slug or the parent.', path: 'slug' }
    ])
  })

  it('refuses a reserved segment in the locale that holds it', async () => {
    const { payload } = test
    const help = await create(payload, 'pages', { slug: 'help', title: 'Help' })

    expect(await catchFieldErrors(update(payload, 'pages', help.id, { slug: 'admin' }, inSwedish))).toMatchObject([
      { locale: 'sv', message: 'The site serves the CMS at /admin, so pick another slug or a parent.', path: 'slug' }
    ])
  })

  it('makes a top-level page the home page in each locale whose slug is the root slug', async () => {
    const { payload } = test
    const home = await create(payload, 'pages', { slug: 'home', title: 'Home' })
    expect(await readPath(payload, 'pages', home.id, inSwedish)).toBe('/')

    await update(payload, 'pages', home.id, { slug: 'hem' }, inSwedish)

    expect(await readPath(payload, 'pages', home.id)).toBe('/')
    expect(await readPath(payload, 'pages', home.id, inSwedish)).toBe('/hem')
    expect(await catchFieldErrors(create(payload, 'pages', { parent: home.id, slug: 'news', title: 'News' }))).toMatchObject([
      { message: "The home page can't hold pages, so pick another parent.", path: 'parent' }
    ])
  })

  it('lifts the documents below a deleted page in every locale', async () => {
    const { payload } = test
    const garden = await create(payload, 'pages', { slug: 'garden', title: 'Garden' })
    await update(payload, 'pages', garden.id, { slug: 'tradgard' }, inSwedish)
    const roses = await create(payload, 'pages', { parent: garden.id, slug: 'roses', title: 'Roses' })
    expect(await readPath(payload, 'pages', roses.id, inSwedish)).toBe('/tradgard/roses')

    await remove(payload, 'pages', garden.id)

    expect(await readPath(payload, 'pages', roses.id)).toBe('/roses')
    expect(await readPath(payload, 'pages', roses.id, inSwedish)).toBe('/roses')
  })

  it('reports the paths a publish changed in the locale it published', async () => {
    const { changes, payload } = test
    const careers = await create(payload, 'pages', { slug: 'careers', title: 'Careers' })
    await create(payload, 'pages', { parent: careers.id, slug: 'openings', title: 'Openings' })
    await update(payload, 'pages', careers.id, { slug: 'karriar' }, inSwedish)
    changes.length = 0

    await update(payload, 'pages', careers.id, { slug: 'jobb' }, inSwedish)

    // The page below is published in English only, so its Swedish path is no published path.
    expect(changes).toEqual([[{ collection: 'pages', from: '/karriar', id: careers.id, locale: 'sv', to: '/jobb' }]])
  })

  it('finds a document by the path of the locale asked for, and a draft only in the locale it was saved in', async () => {
    const { payload } = test
    const menu = await create(payload, 'pages', { slug: 'menu', title: 'Menu' })
    await update(payload, 'pages', menu.id, { slug: 'meny' }, inSwedish)
    const lunch = await create(payload, 'posts', { slug: 'lunch', title: 'Lunch' })
    await update(payload, 'posts', lunch.id, { slug: 'dagens-lunch' }, { draft: true, locale: 'sv' })

    expect(await findByPath({ locale: 'sv', path: '/meny', payload })).toMatchObject({ document: { id: menu.id } })
    expect(await findByPath({ locale: 'en', path: '/meny', payload })).toBeNull()
    expect(await findByPath({ draft: true, locale: 'sv', path: '/dagens-lunch', payload })).toMatchObject({
      document: { id: lunch.id }
    })
    expect(await findByPath({ locale: 'sv', path: '/dagens-lunch', payload })).toBeNull()
    expect(await findByPath({ draft: true, locale: 'en', path: '/lunch', payload })).toMatchObject({ document: { id: lunch.id } })
  })

  it('keeps the published paths when a draft is saved in every locale at once', async () => {
    const { changes, payload } = test
    const orchard = await create(payload, 'posts', { slug: 'orchard', title: 'Orchard' })
    const barn = await create(payload, 'posts', { slug: 'barn', title: 'Barn' })
    const rakes = await create(payload, 'posts', { parent: orchard.id, slug: 'rakes', title: 'Rakes' })
    changes.length = 0

    await update(payload, 'posts', rakes.id, { parent: barn.id }, { draft: true, locale: 'all' })

    expect(await readPath(payload, 'posts', rakes.id, inSwedish)).toBe('/orchard/rakes')
    expect(await readPath(payload, 'posts', rakes.id, { draft: true, locale: 'sv' })).toBe('/barn/rakes')
    expect(changes).toEqual([])
  })

  it('moves the branch when every locale is published at once, each with a slug of its own', async () => {
    const { payload } = test
    const bakery = await create(payload, 'posts', { slug: 'bakery', title: 'Bakery' })
    const loaves = await create(payload, 'posts', { parent: bakery.id, slug: 'loaves', title: 'Loaves' })

    await update(payload, 'posts', bakery.id, { slug: { en: 'Baking', sv: 'Bageriet' } }, { locale: 'all' })

    expect(await readPath(payload, 'posts', loaves.id)).toBe('/baking/loaves')
    expect(await readPath(payload, 'posts', loaves.id, inSwedish)).toBe('/bageriet/loaves')
  })

  it('gives a restored version its path in every locale, and moves its branch, when the request runs in another locale', async () => {
    const { payload } = test
    const depot = await create(payload, 'pages', { slug: 'depot', title: 'Depot' })
    await update(payload, 'pages', depot.id, { slug: 'lager', title: 'Lager' }, inSwedish)
    const crates = await create(payload, 'pages', { parent: depot.id, slug: 'crates', title: 'Crates' })
    await update(payload, 'pages', depot.id, { slug: 'warehouse' })
    await update(payload, 'pages', depot.id, { slug: 'forrad' }, inSwedish)

    await restoreVersion(payload, 'pages', depot.id, { locale: 'sv', version: 1 })

    expect(await readPath(payload, 'pages', depot.id)).toBe('/depot')
    expect(await readPath(payload, 'pages', depot.id, inSwedish)).toBe('/lager')
    expect(await readPath(payload, 'pages', crates.id)).toBe('/depot/crates')
    expect(await readPath(payload, 'pages', crates.id, inSwedish)).toBe('/lager/crates')
  })

  it("gives a restored version each locale's path below where its parent is now", async () => {
    const { payload } = test
    const navy = await create(payload, 'pages', { slug: 'navy', title: 'Navy' })
    await update(payload, 'pages', navy.id, { slug: 'flotta' }, inSwedish)
    const tender = await create(payload, 'pages', { parent: navy.id, slug: 'tender', title: 'Tender' })
    await update(payload, 'pages', tender.id, { title: 'Supply tender' })
    await update(payload, 'pages', navy.id, { slug: 'ships' })
    await update(payload, 'pages', navy.id, { slug: 'skepp' }, inSwedish)

    await restoreVersion(payload, 'pages', tender.id)

    expect(await readPath(payload, 'pages', tender.id)).toBe('/ships/tender')
    expect(await readPath(payload, 'pages', tender.id, inSwedish)).toBe('/skepp/tender')
  })

  it("gives a restored version the other locale's path from the slug that version held there", async () => {
    const { payload } = test
    const atelier = await create(payload, 'pages', { slug: 'atelier', title: 'Atelier' })
    await update(payload, 'pages', atelier.id, { slug: 'verkstad' }, inSwedish)
    await update(payload, 'pages', atelier.id, { slug: 'studio' }, inSwedish)

    await restoreVersion(payload, 'pages', atelier.id, { version: 1 })

    expect(await readPath(payload, 'pages', atelier.id)).toBe('/atelier')
    expect(await readPath(payload, 'pages', atelier.id, inSwedish)).toBe('/verkstad')
  })

  it('gives a restored version its published paths when the request runs in a locale that is a draft', async () => {
    const { payload } = test
    const silo = await create(payload, 'pages', { slug: 'silo', title: 'Silo' })
    const grain = await create(payload, 'pages', { parent: silo.id, slug: 'grain', title: 'Grain' })
    await update(payload, 'pages', silo.id, { slug: 'tower' })

    await restoreVersion(payload, 'pages', silo.id, inSwedish)

    expect(await readPath(payload, 'pages', silo.id)).toBe('/silo')
    expect(await readPath(payload, 'pages', grain.id)).toBe('/silo/grain')
  })

  it('moves the published paths when a save in a locale that stays a draft gives a page a new parent', async () => {
    const { payload } = test
    const yard = await create(payload, 'pages', { slug: 'yard', title: 'Yard' })
    const dock = await create(payload, 'pages', { slug: 'dock', title: 'Dock' })
    const hoist = await create(payload, 'pages', { parent: yard.id, slug: 'hoist', title: 'Hoist' })
    const chain = await create(payload, 'pages', { parent: hoist.id, slug: 'chain', title: 'Chain' })

    await payload.update({ collection: 'pages', data: { parent: dock.id }, id: hoist.id, locale: 'sv', overrideAccess: true })

    expect(await readPath(payload, 'pages', hoist.id)).toBe('/dock/hoist')
    expect(await readPath(payload, 'pages', chain.id)).toBe('/dock/hoist/chain')
  })

  it('refuses a save in a locale that stays a draft when it moves a published path onto another document', async () => {
    const { payload } = test
    const basin = await create(payload, 'pages', { slug: 'basin', title: 'Basin' })
    await create(payload, 'pages', { parent: basin.id, slug: 'winch', title: 'Basin winch' })
    const winch = await create(payload, 'pages', { slug: 'winch', title: 'Winch' })

    expect(
      await catchFieldErrors(
        payload.update({ collection: 'pages', data: { parent: basin.id }, id: winch.id, locale: 'sv', overrideAccess: true })
      )
    ).toMatchObject([
      { locale: 'sv', message: 'Page "Basin winch" is already at this path, so change the slug or the parent.', path: 'slug' }
    ])
  })

  it('moves a page and its branch in every locale when a publish in one locale carries out a parent a draft in another gave it', async () => {
    const { payload } = test
    const east = await create(payload, 'pages', { slug: 'east-wing', title: 'East wing' })
    const west = await create(payload, 'pages', { slug: 'west-wing', title: 'West wing' })
    const hall = await create(payload, 'pages', { parent: east.id, slug: 'hall', title: 'Hall' })
    const seats = await create(payload, 'pages', { parent: hall.id, slug: 'seats', title: 'Seats' })
    await update(payload, 'pages', hall.id, { parent: west.id }, { draft: true, locale: 'sv' })
    expect(await readPath(payload, 'pages', hall.id)).toBe('/east-wing/hall')

    await update(payload, 'pages', hall.id, { title: 'Great hall' })

    expect((await readDocument(payload, 'pages', hall.id)).ancestors).toEqual([west.id])
    expect(await readPath(payload, 'pages', hall.id)).toBe('/west-wing/hall')
    expect(await readPath(payload, 'pages', hall.id, inSwedish)).toBe('/west-wing/hall')
    expect(await readPath(payload, 'pages', seats.id)).toBe('/west-wing/hall/seats')
    expect(await readPath(payload, 'pages', seats.id, inSwedish)).toBe('/west-wing/hall/seats')
  })

  it('refuses a publish in one locale that carries out a parent a draft in another gave the page, onto a path in use', async () => {
    const { payload } = test
    const loft = await create(payload, 'pages', { slug: 'loft', title: 'Loft' })
    const vault = await create(payload, 'pages', { slug: 'vault', title: 'Vault' })
    const trunk = await create(payload, 'pages', { parent: loft.id, slug: 'trunk', title: 'Trunk' })
    await update(payload, 'pages', trunk.id, { parent: vault.id }, { draft: true, locale: 'sv' })
    // A pending move takes no path, so another page can be published where it would go.
    await create(payload, 'pages', { parent: vault.id, slug: 'trunk', title: 'Vault trunk' })

    expect(await catchFieldErrors(update(payload, 'pages', trunk.id, { title: 'Old trunk' }))).toMatchObject([
      { locale: 'en', message: 'Page "Vault trunk" is already at this path, so change the slug or the parent.', path: 'slug' }
    ])
    expect(await readPath(payload, 'pages', trunk.id)).toBe('/loft/trunk')
  })

  it("gives a page and its branch a draft's Swedish slug when every locale is published from English", async () => {
    const { payload } = test
    const forge = await create(payload, 'pages', { slug: 'forge', title: 'Forge' })
    await update(payload, 'pages', forge.id, { slug: 'smedja', title: 'Smedja' }, inSwedish)
    const anvil = await create(payload, 'pages', { parent: forge.id, slug: 'anvil', title: 'Anvil' })
    await update(payload, 'pages', forge.id, { slug: 'hammare' }, { draft: true, locale: 'sv' })

    await payload.update({
      collection: 'pages',
      data: { _status: 'published', title: 'The forge' },
      id: forge.id,
      locale: 'en',
      overrideAccess: true,
      publishAllLocales: true
    })

    expect(await readPath(payload, 'pages', forge.id, inSwedish)).toBe('/hammare')
    expect(await readPath(payload, 'pages', anvil.id, inSwedish)).toBe('/hammare/anvil')
    expect(await readPath(payload, 'pages', anvil.id)).toBe('/forge/anvil')
  })

  it("gives a page and its branch a draft's Swedish slug when a save in every locale at once sends no slug", async () => {
    const { payload } = test
    const kiln = await create(payload, 'pages', { slug: 'kiln', title: 'Kiln' })
    await update(payload, 'pages', kiln.id, { slug: 'ugn', title: 'Ugn' }, inSwedish)
    const tiles = await create(payload, 'pages', { parent: kiln.id, slug: 'tiles', title: 'Tiles' })
    await update(payload, 'pages', kiln.id, { slug: 'brannugn' }, { draft: true, locale: 'sv' })

    await update(payload, 'pages', kiln.id, { title: { en: 'The kiln', sv: 'Ugnen' } }, { locale: 'all' })

    expect(await readPath(payload, 'pages', kiln.id, inSwedish)).toBe('/brannugn')
    expect(await readPath(payload, 'pages', tiles.id, inSwedish)).toBe('/brannugn/tiles')
    expect(await readPath(payload, 'pages', tiles.id)).toBe('/kiln/tiles')
  })

  it('moves a page and its branch when it is unpublished in the locale a draft renamed it in', async () => {
    const { changes, payload } = test
    const stable = await create(payload, 'pages', { slug: 'stable', title: 'Stable' })
    await update(payload, 'pages', stable.id, { slug: 'stall', title: 'Stall' }, inSwedish)
    const hay = await create(payload, 'pages', { parent: stable.id, slug: 'hay', title: 'Hay' })
    await update(payload, 'pages', hay.id, { slug: 'ho', title: 'Hö' }, inSwedish)
    await update(payload, 'pages', stable.id, { slug: 'barn-door' }, { draft: true })
    changes.length = 0

    await payload.update({ collection: 'pages', data: { _status: 'draft' }, id: stable.id, overrideAccess: true })

    expect(await readPath(payload, 'pages', hay.id)).toBe('/barn-door/hay')
    expect(await readPath(payload, 'pages', hay.id, inSwedish)).toBe('/stall/ho')
    // The page is unpublished in English, so a site finds it at no path there, where it moved too. The
    // page below is published in both locales and moved in English only, so it is named there only.
    expect(changes).toEqual([
      [
        { collection: 'pages', from: '/stable', id: stable.id, locale: 'en', to: null },
        { collection: 'pages', from: '/stable/hay', id: hay.id, locale: 'en', to: '/barn-door/hay' }
      ]
    ])
  })

  it("moves a page and its branch to a draft's Swedish slug when every locale is unpublished at once", async () => {
    const { changes, payload } = test
    const granary = await create(payload, 'pages', { slug: 'granary', title: 'Granary' })
    await update(payload, 'pages', granary.id, { slug: 'magasin', title: 'Magasin' }, inSwedish)
    const sacks = await create(payload, 'pages', { parent: granary.id, slug: 'sacks', title: 'Sacks' })
    await update(payload, 'pages', granary.id, { slug: 'spannmal' }, { draft: true, locale: 'sv' })
    changes.length = 0

    await payload.update({
      collection: 'pages',
      data: { _status: 'draft' },
      id: granary.id,
      overrideAccess: true,
      unpublishAllLocales: true
    })

    expect(await readPath(payload, 'pages', sacks.id, inSwedish)).toBe('/spannmal/sacks')
    expect(await readPath(payload, 'pages', sacks.id)).toBe('/granary/sacks')
    // Unpublished in both locales, a site finds the page at no path in either, also in Swedish, where
    // it moved. The page below is published in English only, where it didn't move.
    expect(changes).toEqual([
      [
        { collection: 'pages', from: '/granary', id: granary.id, locale: 'en', to: null },
        { collection: 'pages', from: '/magasin', id: granary.id, locale: 'sv', to: null }
      ]
    ])
  })

  it('reports the paths of every locale a restore changed, of the page and of a page below, whichever locale the request runs in', async () => {
    const { changes, payload } = test
    const bridge = await create(payload, 'pages', { slug: 'bridge', title: 'Bridge' })
    await update(payload, 'pages', bridge.id, { slug: 'bro', title: 'Bro' }, inSwedish)
    await update(payload, 'pages', bridge.id, { slug: 'viaduct' })
    await update(payload, 'pages', bridge.id, { slug: 'viadukt' }, inSwedish)
    const toll = await create(payload, 'pages', { parent: bridge.id, slug: 'toll', title: 'Toll' })
    await update(payload, 'pages', toll.id, { slug: 'tull', title: 'Tull' }, inSwedish)
    changes.length = 0

    await restoreVersion(payload, 'pages', bridge.id, { version: 1 })

    expect(changes).toEqual([
      [
        { collection: 'pages', from: '/viaduct', id: bridge.id, locale: 'en', to: '/bridge' },
        { collection: 'pages', from: '/viadukt', id: bridge.id, locale: 'sv', to: '/bro' },
        { collection: 'pages', from: '/viaduct/toll', id: toll.id, locale: 'en', to: '/bridge/toll' },
        { collection: 'pages', from: '/viadukt/tull', id: toll.id, locale: 'sv', to: '/bro/tull' }
      ]
    ])
  })

  it('moves the branch and reports the paths when a restore runs in a published locale of a page that is a draft in the default locale', async () => {
    const { changes, payload } = test
    const ferry = await create(payload, 'pages', { slug: 'ferry', title: 'Ferry' }, { draft: true })
    await update(payload, 'pages', ferry.id, { slug: 'farja', title: 'Färja' }, inSwedish)
    const deck = await create(payload, 'pages', { parent: ferry.id, slug: 'deck', title: 'Deck' })
    await update(payload, 'pages', ferry.id, { slug: 'batfarja' }, inSwedish)
    changes.length = 0

    await restoreVersion(payload, 'pages', ferry.id, { locale: 'sv', version: 1 })

    expect(await readPath(payload, 'pages', ferry.id, inSwedish)).toBe('/farja')
    expect(await readPath(payload, 'pages', deck.id, inSwedish)).toBe('/farja/deck')
    // The page below is published in English only, where its path stays.
    expect(changes).toEqual([[{ collection: 'pages', from: '/batfarja', id: ferry.id, locale: 'sv', to: '/farja' }]])
  })

  it("leaves the other locale published in the latest version when a draft renames one locale's slug, and when a draft follows its publish", async () => {
    const { payload } = test
    const sawmill = await create(payload, 'pages', { slug: 'sawmill', title: 'Sawmill' })
    await update(payload, 'pages', sawmill.id, { slug: 'sagverk', title: 'Sågverk' }, inSwedish)

    await update(payload, 'pages', sawmill.id, { slug: 'sagen' }, { draft: true, locale: 'sv' })
    expect(await readLatestVersion(payload, 'pages', sawmill.id)).toMatchObject({
      _status: { en: 'published', sv: 'draft' }
    })

    await update(payload, 'pages', sawmill.id, {}, inSwedish)
    expect(await readLatestVersion(payload, 'pages', sawmill.id)).toMatchObject({
      _status: { en: 'published', sv: 'published' }
    })

    await update(payload, 'pages', sawmill.id, { title: 'Sågen' }, { draft: true, locale: 'sv' })
    expect(await readLatestVersion(payload, 'pages', sawmill.id)).toMatchObject({
      _status: { en: 'published', sv: 'draft' }
    })
  })

  it('keeps the path of a locale a page is not published in when a publish in another locale keeps the slug and the parent', async () => {
    const { payload } = test
    const cellar = await create(payload, 'pages', { slug: 'cellar', title: 'Cellar' })
    const casks = await create(payload, 'pages', { parent: cellar.id, slug: 'casks', title: 'Casks' })

    // Payload writes a publish in one locale to the page itself without what the other locale held.
    await update(payload, 'pages', cellar.id, { title: 'Wine cellar' })

    expect(await readStoredPaths(payload, 'pages', cellar.id)).toEqual({ en: '/cellar', sv: '/cellar' })
    expect(await findByPath({ draft: true, locale: 'sv', path: '/cellar', payload })).toMatchObject({
      document: { id: cellar.id }
    })
    const corks = await create(payload, 'pages', { parent: cellar.id, slug: 'corks', title: 'Corks' })
    expect(await readStoredPaths(payload, 'pages', corks.id)).toEqual({ en: '/cellar/corks', sv: '/cellar/corks' })

    await update(payload, 'pages', cellar.id, { slug: 'wine-cellar' })

    expect(await readStoredPaths(payload, 'pages', casks.id)).toEqual({ en: '/wine-cellar/casks', sv: '/wine-cellar/casks' })
  })

  it('keeps the path a post waits at in a locale it is not published in yet, through a publish in the default locale, so no other document takes it', async () => {
    const { payload } = test
    const post = await create(payload, 'posts', { slug: 'launch', title: 'Launch' })
    await update(payload, 'posts', post.id, { slug: 'lansering' }, { draft: true, locale: 'sv' })
    const page = await create(payload, 'pages', { slug: 'news', title: 'News' })
    const refusal = [{ locale: 'sv', message: expect.stringContaining('is already at this path'), path: 'slug' }]
    const takeSwedishPath = (draft: boolean) =>
      catchFieldErrors(update(payload, 'pages', page.id, { slug: 'lansering' }, { draft, locale: 'sv' }))

    expect(await takeSwedishPath(false)).toMatchObject(refusal)
    expect(await takeSwedishPath(true)).toMatchObject(refusal)

    // The post is published in English again, which Payload writes without what Swedish held.
    await update(payload, 'posts', post.id, { title: 'Launch day' })

    expect(await takeSwedishPath(false)).toMatchObject(refusal)
    expect(await takeSwedishPath(true)).toMatchObject(refusal)
    expect(await findByPath({ locale: 'sv', path: '/lansering', payload })).toBeNull()

    await update(payload, 'posts', post.id, {}, inSwedish)

    expect(await findByPath({ locale: 'sv', path: '/lansering', payload })).toMatchObject({ document: { id: post.id } })
    expect(await findByPath({ locale: 'en', path: '/launch', payload })).toMatchObject({ document: { id: post.id } })
  })

  it('moves a page with a Swedish slug of its own below a page published in English only, when that page is renamed after a publish', async () => {
    const { payload } = test
    const pantry = await create(payload, 'pages', { slug: 'pantry', title: 'Pantry' })
    const jars = await create(payload, 'pages', { parent: pantry.id, slug: 'jars', title: 'Jars' })
    await update(payload, 'pages', jars.id, { slug: 'burkar', title: 'Burkar' }, inSwedish)
    await update(payload, 'pages', pantry.id, { title: 'The pantry' })

    await update(payload, 'pages', pantry.id, { slug: 'larder' })

    expect(await readStoredPaths(payload, 'pages', jars.id)).toEqual({ en: '/larder/jars', sv: '/larder/burkar' })
    expect(await findByPath({ locale: 'sv', path: '/larder/burkar', payload })).toMatchObject({ document: { id: jars.id } })
  })

  it("keeps every locale's path when a save that sends no status ends published in its locale", async () => {
    const { payload } = test
    const scullery = await create(payload, 'pages', { slug: 'scullery', title: 'Scullery' })

    await payload.update({ collection: 'pages', data: { title: 'The scullery' }, id: scullery.id, overrideAccess: true })

    expect(await readStoredPaths(payload, 'pages', scullery.id)).toEqual({ en: '/scullery', sv: '/scullery' })
  })

  it('moves nothing in a locale a page is unpublished in when it is published in another locale', async () => {
    const { changes, payload } = test
    const bakehouse = await create(payload, 'pages', { slug: 'bakehouse', title: 'Bakehouse' })
    await update(payload, 'pages', bakehouse.id, { slug: 'bagarstuga', title: 'Bagarstuga' }, inSwedish)
    const ovens = await create(payload, 'pages', { parent: bakehouse.id, slug: 'ovens', title: 'Ovens' })
    await update(payload, 'pages', ovens.id, { title: 'Ugnar' }, inSwedish)
    await payload.update({
      collection: 'pages',
      data: { _status: 'draft' },
      id: bakehouse.id,
      locale: 'sv',
      overrideAccess: true
    })
    expect(await readStoredPaths(payload, 'pages', bakehouse.id)).toEqual({ en: '/bakehouse', sv: '/bagarstuga' })
    changes.length = 0

    // Payload writes the English publish to the page itself without the Swedish slug. The page isn't
    // published in Swedish, so there it is where its latest draft says, which is where it was.
    await update(payload, 'pages', bakehouse.id, {})

    expect(await readStoredPaths(payload, 'pages', bakehouse.id)).toEqual({ en: '/bakehouse', sv: '/bagarstuga' })
    expect(await readStoredPaths(payload, 'pages', ovens.id)).toEqual({ en: '/bakehouse/ovens', sv: '/bagarstuga/ovens' })
    expect(changes).toEqual([[{ collection: 'pages', from: '/bakehouse', id: bakehouse.id, locale: 'en', to: '/bakehouse' }]])
    expect(await readLatestVersion(payload, 'pages', bakehouse.id)).toMatchObject({
      path: { en: '/bakehouse', sv: '/bagarstuga' }
    })

    await update(payload, 'pages', bakehouse.id, {}, inSwedish)

    expect(await readStoredPaths(payload, 'pages', bakehouse.id)).toEqual({ en: '/bakehouse', sv: '/bagarstuga' })
    expect(await readStoredPaths(payload, 'pages', ovens.id)).toEqual({ en: '/bakehouse/ovens', sv: '/bagarstuga/ovens' })
  })

  it('moves nothing when a publish keeps the slug and the parent of a page published in every locale', async () => {
    const { changes, payload } = test
    const dairy = await create(payload, 'pages', { slug: 'dairy', title: 'Dairy' })
    await update(payload, 'pages', dairy.id, { slug: 'mejeri', title: 'Mejeri' }, inSwedish)
    const churn = await create(payload, 'pages', { parent: dairy.id, slug: 'churn', title: 'Churn' })
    changes.length = 0

    await update(payload, 'pages', dairy.id, { title: 'The dairy' })

    expect(await readStoredPaths(payload, 'pages', dairy.id)).toEqual({ en: '/dairy', sv: '/mejeri' })
    expect(await readStoredPaths(payload, 'pages', churn.id)).toEqual({ en: '/dairy/churn', sv: '/mejeri/churn' })
    expect(changes).toEqual([[{ collection: 'pages', from: '/dairy', id: dairy.id, locale: 'en', to: '/dairy' }]])
  })

  it("keeps every locale's path when a publish that keeps the slug and the parent is sent with a select that leaves the status out", async () => {
    const { changes, payload } = test
    const icehouse = await create(payload, 'pages', { slug: 'icehouse', title: 'Icehouse' })
    changes.length = 0

    await payload.update({
      collection: 'pages',
      data: { _status: 'published', title: 'The icehouse' },
      id: icehouse.id,
      overrideAccess: true,
      select: { title: true }
    })

    expect(await readStoredPaths(payload, 'pages', icehouse.id)).toEqual({ en: '/icehouse', sv: '/icehouse' })
    expect(changes).toEqual([[{ collection: 'pages', from: '/icehouse', id: icehouse.id, locale: 'en', to: '/icehouse' }]])
  })

  // A document stored before the plugin has values in English only, so on Postgres and SQLite it has
  // no row for Swedish yet.
  it('gives a document stored before the plugin its path in every locale when a page above it is renamed', async () => {
    const { payload } = test
    const shelf = await create(payload, 'pages', { slug: 'shelf', title: 'Shelf' })
    const book = await store(test, setup, 'pages', { ancestors: [shelf.id], parent: shelf.id, slug: 'book', title: 'Book' })

    await update(payload, 'pages', shelf.id, { slug: 'bookcase' })

    const bothLocales = { en: '/bookcase/book', sv: '/bookcase/book' }
    expect(await readStoredPaths(payload, 'pages', book)).toEqual(bothLocales)
    expect((await readLatestVersion(payload, 'pages', book)).path).toEqual(bothLocales)
  })

  it('gives a document of a collection without drafts the path of each locale it is saved in, and moves it with its parent', async () => {
    const { payload } = test
    const visit = await create(payload, 'notices', { slug: 'visit', title: 'Visit' })
    await update(payload, 'notices', visit.id, { slug: 'besok', title: 'Besök' }, inSwedish)
    const hours = await create(payload, 'notices', { parent: visit.id, slug: 'hours', title: 'Hours' })
    const swedish = await update(payload, 'notices', hours.id, { slug: 'oppettider', title: 'Öppettider' }, inSwedish)

    await update(payload, 'notices', visit.id, { slug: 'besok-oss' }, inSwedish)

    expect([hours.path, swedish.path]).toEqual(['/visit/hours', '/besok/oppettider'])
    expect(await findByPath({ locale: 'en', path: '/visit/hours', payload })).toMatchObject({ document: { id: hours.id } })
    expect(await findByPath({ locale: 'sv', path: '/besok-oss/oppettider', payload })).toMatchObject({
      collection: 'notices',
      document: { id: hours.id }
    })
  })

  it('gives the documents below a document of a collection without drafts their path in a locale once that document gets its first slug there', async () => {
    const { payload } = test
    const lounge = await create(payload, 'notices', { slug: 'lounge', title: 'Lounge' })
    const menu = await create(payload, 'notices', { parent: lounge.id, slug: 'menu', title: 'Menu' })
    await update(payload, 'notices', menu.id, { slug: 'meny', title: 'Meny' }, inSwedish)
    expect(await readStoredPaths(payload, 'notices', menu.id)).toEqual({ en: '/lounge/menu', sv: null })

    await update(payload, 'notices', lounge.id, { slug: 'salong', title: 'Salong' }, inSwedish)

    expect(await readStoredPaths(payload, 'notices', menu.id)).toEqual({ en: '/lounge/menu', sv: '/salong/meny' })
  })

  it('gives the documents below a deleted document of a collection without drafts their path in a locale the deleted document had none in', async () => {
    const { payload } = test
    const lobby = await create(payload, 'notices', { slug: 'lobby', title: 'Lobby' })
    const map = await create(payload, 'notices', { parent: lobby.id, slug: 'map', title: 'Map' })
    await update(payload, 'notices', map.id, { slug: 'karta', title: 'Karta' }, inSwedish)
    expect(await readStoredPaths(payload, 'notices', map.id)).toEqual({ en: '/lobby/map', sv: null })

    await remove(payload, 'notices', lobby.id)

    expect(await readStoredPaths(payload, 'notices', map.id)).toEqual({ en: '/map', sv: '/karta' })
    expect(await readDocument(payload, 'notices', map.id)).toMatchObject({ ancestors: [], parent: null })
  })

  it('gives a document below with a path in one locale only its new path there when a save renames the document above in every locale at once', async () => {
    const { payload } = test
    const foyer = await create(payload, 'notices', { slug: 'foyer', title: 'Foyer' })
    await update(payload, 'notices', foyer.id, { slug: 'entre', title: 'Entré' }, inSwedish)
    const coats = await create(payload, 'notices', { parent: foyer.id, slug: 'coats', title: 'Coats' })
    expect(await readStoredPaths(payload, 'notices', coats.id)).toEqual({ en: '/foyer/coats' })

    await update(payload, 'notices', foyer.id, { slug: { en: 'lobby', sv: 'lobbyn' } }, { locale: 'all' })

    expect(await readStoredPaths(payload, 'notices', coats.id)).toEqual({ en: '/lobby/coats' })
  })
})

// Swedish has no fallbackLocale and fallback is off, so it skips the default locale and takes the
// first slug in the order the locales are listed.
const FALLBACK_CHAIN = {
  defaultLocale: 'en',
  fallback: false,
  locales: [
    { code: 'nb', fallbackLocale: 'en', label: 'Norsk' },
    { code: 'sv', label: 'Svenska' },
    { code: 'en', label: 'English' }
  ]
}

describeEachSetup(
  'with fallback off and a fallbackLocale',
  { boot: { localization: FALLBACK_CHAIN }, setups: LOCALIZED_SETUPS },
  (test) => {
    it('makes the path of a locale without a slug from the slug of its fallbackLocale', async () => {
      const { payload } = test
      const about = await create(payload, 'pages', { slug: 'about', title: 'About' })

      await update(payload, 'pages', about.id, { slug: 'om-oss' }, inSwedish)

      expect(await readStoredPaths(payload, 'pages', about.id)).toEqual({ en: '/about', nb: '/about', sv: '/om-oss' })
    })

    it('makes the path of a locale without a slug or a fallbackLocale from the first locale listed with a slug', async () => {
      const { payload } = test
      const contact = await create(payload, 'pages', { slug: 'contact', title: 'Contact' })

      await update(payload, 'pages', contact.id, { slug: 'kontakt' }, { locale: 'nb' })

      expect(await readStoredPaths(payload, 'pages', contact.id)).toEqual({ en: '/contact', nb: '/kontakt', sv: '/kontakt' })
    })
  }
)
