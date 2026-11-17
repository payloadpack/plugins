import { beforeEach, expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import type { Id } from '../src/paths/place.js'
import { describeEachSetup } from './support/boot-payload.js'
import { create, readPath, remove, update } from './support/documents.js'

describeEachSetup('', {}, (test, setup) => {
  beforeEach(() => {
    test.changes.length = 0
  })

  // Without localization a changed path has no locale; with it, the locale it belongs to.
  const at = (path: string) => (setup.localized ? { locale: 'en', path } : { path })
  // Where a branch went. With localization Swedish falls back to the English slug, so it went there too.
  const fromTo = (from: string, to: string) =>
    setup.localized ? ['en', 'sv'].map((locale) => ({ from, locale, to })) : [{ from, to }]
  const unpublish = (id: Id) => test.payload.update({ collection: 'pages', data: { _status: 'draft' }, id, overrideAccess: true })

  it('reports the path of a publish', async () => {
    const { changes, payload } = test
    await create(payload, 'pages', { slug: 'news', title: 'News' })

    expect(changes).toEqual([{ paths: [at('/news')] }])
  })

  it('reports nothing for a draft save', async () => {
    const { changes, payload } = test
    const weather = await create(payload, 'pages', { slug: 'weather', title: 'Weather' })
    changes.length = 0

    await update(payload, 'pages', weather.id, { title: 'Latest weather' }, { draft: true })

    expect(changes).toEqual([])
  })

  it('reports where a move took a document from and to, with how many documents sit below it, in any collection', async () => {
    const { changes, payload } = test
    const blog = await create(payload, 'pages', { slug: 'blog', title: 'Blog' })
    const archive = await create(payload, 'pages', { parent: blog.id, slug: 'archive', title: 'Archive' })
    await create(payload, 'pages', { parent: archive.id, slug: 'older', title: 'Older' })
    const series = await create(payload, 'posts', { slug: 'series', title: 'Series' })
    await create(payload, 'posts', { parent: series.id, slug: 'part-one', title: 'Part one' })
    const vault = await create(payload, 'pages', { slug: 'vault', title: 'Vault' })
    changes.length = 0

    await update(payload, 'pages', blog.id, { slug: 'journal' })
    await update(payload, 'posts', series.id, { slug: 'saga' })
    await update(payload, 'pages', archive.id, { parent: vault.id })

    expect(changes).toEqual([
      {
        moved: { collection: 'pages', documentsBelow: 2, id: blog.id, paths: fromTo('/blog', '/journal') },
        paths: [at('/journal'), at('/blog')]
      },
      {
        moved: { collection: 'posts', documentsBelow: 1, id: series.id, paths: fromTo('/series', '/saga') },
        paths: [at('/saga'), at('/series')]
      },
      {
        moved: { collection: 'pages', documentsBelow: 1, id: archive.id, paths: fromTo('/journal/archive', '/vault/archive') },
        paths: [at('/vault/archive'), at('/journal/archive')]
      }
    ])
  })

  it('reports a move with nothing below the document', async () => {
    const { changes, payload } = test
    const contact = await create(payload, 'posts', { slug: 'contact', title: 'Contact' })
    changes.length = 0

    await update(payload, 'posts', contact.id, { slug: 'reach-us' })

    expect(changes).toEqual([
      {
        moved: { collection: 'posts', documentsBelow: 0, id: contact.id, paths: fromTo('/contact', '/reach-us') },
        paths: [at('/reach-us'), at('/contact')]
      }
    ])
  })

  it('reports the move of a document that is not published, with no published path', async () => {
    const { changes, payload } = test
    const sketch = await create(payload, 'pages', { slug: 'sketch', title: 'Sketch' }, { draft: true })
    changes.length = 0

    await update(payload, 'pages', sketch.id, { slug: 'outline' }, { draft: true })

    expect(changes).toEqual([
      { moved: { collection: 'pages', documentsBelow: 0, id: sketch.id, paths: fromTo('/sketch', '/outline') }, paths: [] }
    ])
  })

  it('reports no move for a publish that keeps the slug and the parent', async () => {
    const { changes, payload } = test
    const terms = await create(payload, 'pages', { slug: 'terms', title: 'Terms' })
    await create(payload, 'pages', { parent: terms.id, slug: 'privacy', title: 'Privacy' })
    changes.length = 0

    await update(payload, 'pages', terms.id, { title: 'Our terms' })

    expect(changes).toEqual([{ paths: [at('/terms')] }])
  })

  it('reports the path an unpublish left, and nothing for a save of the draft after it', async () => {
    const { changes, payload } = test
    const forecast = await create(payload, 'pages', { slug: 'forecast', title: 'Forecast' })
    changes.length = 0

    await unpublish(forecast.id)
    await update(payload, 'pages', forecast.id, { title: 'The forecast' }, { draft: true })

    expect(changes).toEqual([{ paths: [at('/forecast')] }])
  })

  it('reports the path of a deleted document, and where the documents below it were lifted from and to', async () => {
    const { changes, payload } = test
    const lab = await create(payload, 'pages', { slug: 'lab', title: 'Lab' })
    const bench = await create(payload, 'pages', { parent: lab.id, slug: 'bench', title: 'Bench' })
    const tools = await create(payload, 'pages', { parent: bench.id, slug: 'tools', title: 'Tools' })
    await create(payload, 'pages', { parent: tools.id, slug: 'pliers', title: 'Pliers' })
    changes.length = 0

    await remove(payload, 'pages', bench.id)
    await remove(payload, 'pages', lab.id)

    expect(changes).toEqual([
      {
        lifted: { collection: 'pages', documentsBelow: 2, id: bench.id, paths: fromTo('/lab/bench', '/lab') },
        paths: [at('/lab/bench')]
      },
      // At the root the lifted documents' paths start with nothing but the slash.
      { lifted: { collection: 'pages', documentsBelow: 2, id: lab.id, paths: fromTo('/lab', '') }, paths: [at('/lab')] }
    ])
  })

  it('reports the path of a deleted document with nothing below it, and nothing for a deleted draft', async () => {
    const { changes, payload } = test
    const flyer = await create(payload, 'pages', { slug: 'flyer', title: 'Flyer' })
    const draft = await create(payload, 'pages', { slug: 'scribble', title: 'Scribble' }, { draft: true })
    changes.length = 0

    await remove(payload, 'pages', flyer.id)
    await remove(payload, 'pages', draft.id)

    expect(changes).toEqual([{ paths: [at('/flyer')] }])
  })
})

// The context a save passes to make the site's onPathsChanged below fail.
const PURGE_FAILS = { purgeFails: true }

describeEachSetup(
  'with an onPathsChanged that throws',
  {
    boot: {
      options: {
        onPathsChanged: (_change, req) => {
          if (req.context.purgeFails) throw new Error('The purge failed.')
        }
      }
    }
  },
  (test) => {
    it('fails the publish of a new document and stores none of it', async () => {
      const { payload } = test

      await expect(
        payload.create({
          collection: 'pages',
          context: PURGE_FAILS,
          data: { _status: 'published', slug: 'cellar', title: 'Cellar' },
          overrideAccess: true
        })
      ).rejects.toThrow('The purge failed.')
      expect(await findByPath({ draft: true, path: '/cellar', payload })).toBeNull()
    })

    it('fails a move and leaves the document and its branch where they were', async () => {
      const { payload } = test
      const vault = await create(payload, 'pages', { slug: 'vault', title: 'Vault' })
      const gold = await create(payload, 'pages', { parent: vault.id, slug: 'gold', title: 'Gold' })

      await expect(
        payload.update({
          collection: 'pages',
          context: PURGE_FAILS,
          data: { _status: 'published', slug: 'safe' },
          id: vault.id,
          overrideAccess: true
        })
      ).rejects.toThrow('The purge failed.')
      expect(await readPath(payload, 'pages', vault.id)).toBe('/vault')
      expect(await readPath(payload, 'pages', vault.id, { draft: true })).toBe('/vault')
      expect(await readPath(payload, 'pages', gold.id)).toBe('/vault/gold')
    })

    it('fails a delete and keeps the document and its branch', async () => {
      const { payload } = test
      const shed = await create(payload, 'pages', { slug: 'shed', title: 'Shed' })
      const rake = await create(payload, 'pages', { parent: shed.id, slug: 'rake', title: 'Rake' })

      await expect(
        payload.delete({ collection: 'pages', context: PURGE_FAILS, id: shed.id, overrideAccess: true })
      ).rejects.toThrow('The purge failed.')
      expect(await findByPath({ path: '/shed', payload })).toMatchObject({ document: { id: shed.id } })
      expect(await readPath(payload, 'pages', rake.id)).toBe('/shed/rake')
    })
  }
)
