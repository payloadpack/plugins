import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup } from './support/boot-payload.js'
import { create, readPath } from './support/documents.js'
import { SETUPS } from './support/setups.js'

describeEachSetup('', {}, (test) => {
  it('moves several pages and the pages below them in one bulk update', async () => {
    const { payload } = test
    const library = await create(payload, 'pages', { slug: 'library', title: 'Library' })
    const fiction = await create(payload, 'pages', { slug: 'fiction', title: 'Fiction' })
    const poetry = await create(payload, 'pages', { slug: 'poetry', title: 'Poetry' })
    const sonnets = await create(payload, 'pages', { parent: poetry.id, slug: 'sonnets', title: 'Sonnets' })

    await payload.update({
      collection: 'pages',
      data: { _status: 'published', parent: library.id },
      overrideAccess: true,
      where: { id: { in: [fiction.id, poetry.id] } }
    })

    expect(await readPath(payload, 'pages', fiction.id)).toBe('/library/fiction')
    expect(await readPath(payload, 'pages', sonnets.id)).toBe('/library/poetry/sonnets')
  })

  it('lists the refused page of a bulk update in its errors, and saves the others', async () => {
    const { payload } = test
    const museum = await create(payload, 'pages', { slug: 'museum', title: 'Museum' })
    await create(payload, 'pages', { parent: museum.id, slug: 'armour', title: 'Armour hall' })
    const armour = await create(payload, 'pages', { slug: 'armour', title: 'Armour' })
    const coins = await create(payload, 'pages', { slug: 'coins', title: 'Coins' })
    const maps = await create(payload, 'pages', { slug: 'maps', title: 'Maps' })

    const { docs, errors } = await payload.update({
      collection: 'pages',
      data: { _status: 'published', parent: museum.id },
      overrideAccess: true,
      where: { id: { in: [armour.id, coins.id, maps.id] } }
    })

    expect(errors).toMatchObject([{ id: armour.id }])
    expect(docs.map(({ id }) => id).sort()).toEqual([coins.id, maps.id].sort())
    expect(await readPath(payload, 'pages', armour.id)).toBe('/armour')
    expect(await readPath(payload, 'pages', coins.id)).toBe('/museum/coins')
    expect(await readPath(payload, 'pages', maps.id)).toBe('/museum/maps')
  })

  it('lists the refused page of a bulk delete in its errors, and deletes the others', async () => {
    const { payload } = test
    await create(payload, 'pages', { slug: 'press', title: 'Press' })
    const media = await create(payload, 'pages', { slug: 'media', title: 'Media' })
    const press = await create(payload, 'pages', { parent: media.id, slug: 'press', title: 'Press kit' })
    const studio = await create(payload, 'pages', { slug: 'studio', title: 'Studio' })
    const podcast = await create(payload, 'pages', { parent: studio.id, slug: 'podcast', title: 'Podcast' })

    const { errors } = await payload.delete({
      collection: 'pages',
      overrideAccess: true,
      where: { id: { in: [media.id, studio.id] } }
    })

    expect(errors).toMatchObject([{ id: media.id }])
    expect(await readPath(payload, 'pages', press.id)).toBe('/media/press')
    expect(await findByPath({ path: '/studio', payload })).toBeNull()
    expect(await readPath(payload, 'pages', podcast.id)).toBe('/podcast')
  })
})

describeEachSetup(
  'with bulkOperationsSingleTransaction',
  { boot: { bulkOperationsSingleTransaction: true }, setups: SETUPS.filter(({ database }) => database === 'mongodb') },
  (test) => {
    it('refuses only the refused page of a bulk delete, and deletes the others', async () => {
      const { payload } = test
      await create(payload, 'pages', { slug: 'newsroom', title: 'Newsroom' })
      const archive = await create(payload, 'pages', { slug: 'archive', title: 'Archive' })
      const newsroom = await create(payload, 'pages', { parent: archive.id, slug: 'newsroom', title: 'Old newsroom' })
      const radio = await create(payload, 'pages', { slug: 'radio', title: 'Radio' })
      const show = await create(payload, 'pages', { parent: radio.id, slug: 'show', title: 'Show' })

      const { errors } = await payload.delete({
        collection: 'pages',
        overrideAccess: true,
        where: { id: { in: [archive.id, radio.id] } }
      })

      expect(errors).toMatchObject([{ id: archive.id }])
      expect(await readPath(payload, 'pages', newsroom.id)).toBe('/archive/newsroom')
      expect(await findByPath({ path: '/radio', payload })).toBeNull()
      expect(await readPath(payload, 'pages', show.id)).toBe('/show')
    })

    // Payload 4.0.0-beta.9 keeps the documents of a bulk update in the operation's transaction until
    // one fails, which rolls back the ones saved before it, so the refused page is sorted first.
    it('refuses only the refused page of a bulk update, and saves the pages after it', async () => {
      const { payload } = test
      const museum = await create(payload, 'pages', { slug: 'museum', title: 'Museum' })
      await create(payload, 'pages', { parent: museum.id, slug: 'armour', title: 'Armour hall' })
      const armour = await create(payload, 'pages', { slug: 'armour', title: 'Armour' })
      const coins = await create(payload, 'pages', { slug: 'coins', title: 'Coins' })

      const { errors } = await payload.update({
        collection: 'pages',
        data: { _status: 'published', parent: museum.id },
        overrideAccess: true,
        sort: 'title',
        where: { id: { in: [armour.id, coins.id] } }
      })

      expect(errors).toMatchObject([{ id: armour.id }])
      expect(await readPath(payload, 'pages', armour.id)).toBe('/armour')
      expect(await readPath(payload, 'pages', coins.id)).toBe('/museum/coins')
    })
  }
)
