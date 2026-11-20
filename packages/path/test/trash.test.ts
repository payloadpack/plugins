import { beforeEach, expect, it } from 'vitest'

import { backfillPaths, findByPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, changed, create, readPath, update } from './support/documents.js'

// A collection whose deleted documents go to the trash first. Trashing is a save that sets deletedAt,
// and taking a document out of the trash is one that clears it, so the plugin's save hooks see both.
describeEachSetup(
  'with a collection that has a trash',
  {
    boot: (setup) => ({
      collections: [{ ...titled('articles', setup.localized), trash: true }],
      options: { collections: ['pages', 'articles'] }
    })
  },
  (test, setup) => {
    beforeEach(() => {
      test.changes.length = 0
    })

    const takenAt = (document: string, path: string) => [
      { message: `${document} is already at ${path}, so change the slug or the parent.`, path: 'slug' }
    ]

    const trash = (id: Id) =>
      test.payload.update({
        collection: 'articles',
        data: { deletedAt: new Date().toISOString() },
        id,
        overrideAccess: true
      })
    // As the admin restores: a document leaves the trash as a draft unless the editor picks published.
    const restore = (id: Id, status: 'draft' | 'published') =>
      test.payload.update({
        collection: 'articles',
        data: { _status: status, deletedAt: null },
        id,
        overrideAccess: true,
        trash: true
      })
    const readTrashed = (id: Id) =>
      test.payload.findByID({ collection: 'articles', depth: 0, id, overrideAccess: true, trash: true })

    it('frees the path of a document in the trash, which keeps its path and ancestors, as do the documents below it', async () => {
      const { payload } = test
      const guide = await create(payload, 'articles', { slug: 'guide', title: 'Guide' })
      const intro = await create(payload, 'articles', { parent: guide.id, slug: 'intro', title: 'Intro' })

      await trash(guide.id)

      expect(await readTrashed(guide.id)).toMatchObject({ ancestors: [], path: '/guide' })
      expect(await readPath(payload, 'articles', intro.id)).toBe('/guide/intro')
      expect(await findByPath({ path: '/guide/intro', payload })).toMatchObject({ document: { id: intro.id } })
      // Another document takes the path, in this collection or in another.
      const page = await create(payload, 'pages', { slug: 'guide', title: 'Guide page' })
      expect(page.path).toBe('/guide')
    })

    it('finds no document in the trash, published or as a draft', async () => {
      const { payload } = test
      const recall = await create(payload, 'articles', { slug: 'recall', title: 'Recall' })
      expect(await findByPath({ path: '/recall', payload })).toMatchObject({ document: { id: recall.id } })

      await trash(recall.id)

      expect(await findByPath({ path: '/recall', payload })).toBeNull()
      expect(await findByPath({ draft: true, path: '/recall', payload })).toBeNull()
    })

    it('tells the site the paths of a published document that goes to the trash, and lifts nothing', async () => {
      const { changes, payload } = test
      const notice = await create(payload, 'articles', { slug: 'notice', title: 'Notice' })
      const detail = await create(payload, 'articles', { parent: notice.id, slug: 'detail', title: 'Detail' })
      const sketch = await create(payload, 'articles', { slug: 'sketch', title: 'Sketch' }, { draft: true })
      changes.length = 0

      await trash(notice.id)
      await trash(sketch.id)

      expect(changes).toEqual([[changed(setup, 'articles', notice, '/notice', null)]])
      expect(await readPath(payload, 'articles', detail.id)).toBe('/notice/detail')
    })

    it('takes a document out of the trash at its path while that is free, published or as a draft', async () => {
      const { changes, payload } = test
      const memo = await create(payload, 'articles', { slug: 'memo', title: 'Memo' })
      const brief = await create(payload, 'articles', { slug: 'brief', title: 'Brief' })
      await trash(memo.id)
      await trash(brief.id)
      changes.length = 0

      await restore(memo.id, 'published')
      await restore(brief.id, 'draft')

      expect(await findByPath({ path: '/memo', payload })).toMatchObject({ document: { id: memo.id } })
      expect(await findByPath({ path: '/brief', payload })).toBeNull()
      expect(await findByPath({ draft: true, path: '/brief', payload })).toMatchObject({ document: { id: brief.id } })
      // Only the published one shows at its path again.
      expect(changes).toEqual([[changed(setup, 'articles', memo, null, '/memo')]])
      // Both take their paths again.
      expect(await catchFieldErrors(create(payload, 'pages', { slug: 'brief', title: 'Brief page' }))).toMatchObject([
        { message: 'Article "Brief" is already at this path, so change the slug or the parent.', path: 'slug' }
      ])
    })

    it('refuses to take a document out of the trash, published or as a draft, at a path taken since', async () => {
      const { payload } = test
      const report = await create(payload, 'articles', { slug: 'report', title: 'Report' })
      await trash(report.id)
      await create(payload, 'pages', { slug: 'report', title: 'New report' }, { draft: true })

      expect(await catchFieldErrors(restore(report.id, 'published'))).toMatchObject(takenAt('Page "New report"', '/report'))
      expect(await catchFieldErrors(restore(report.id, 'draft'))).toMatchObject(takenAt('Page "New report"', '/report'))

      expect((await readTrashed(report.id)).deletedAt).toEqual(expect.any(String))
      expect(await findByPath({ draft: true, path: '/report', payload })).toMatchObject({ collection: 'pages' })
    })

    it('takes documents out of the trash in bulk, as the admin does, and lists the one whose path was taken since', async () => {
      const { payload } = test
      const digest = await create(payload, 'articles', { slug: 'digest', title: 'Digest' })
      const bulletin = await create(payload, 'articles', { slug: 'bulletin', title: 'Bulletin' })
      await trash(digest.id)
      await trash(bulletin.id)
      await create(payload, 'articles', { slug: 'bulletin', title: 'New bulletin' })

      const { docs, errors } = await payload.update({
        collection: 'articles',
        data: { _status: 'draft', deletedAt: null },
        overrideAccess: true,
        trash: true,
        where: { id: { in: [digest.id, bulletin.id] } }
      })

      expect(docs.map(({ id }) => id)).toEqual([digest.id])
      expect(errors).toMatchObject([{ id: bulletin.id }])
      expect(await findByPath({ draft: true, path: '/digest', payload })).toMatchObject({ document: { id: digest.id } })
      expect((await readTrashed(bulletin.id)).deletedAt).toEqual(expect.any(String))
    })

    it('takes one of two documents that store the same path out of the trash in bulk, and refuses the other', async () => {
      const { payload } = test
      const almanac = await create(payload, 'articles', { slug: 'almanac', title: 'Almanac' })
      await trash(almanac.id)
      const reprint = await create(payload, 'articles', { slug: 'almanac', title: 'Reprint' })
      await trash(reprint.id)

      const { docs, errors } = await payload.update({
        collection: 'articles',
        data: { _status: 'draft', deletedAt: null },
        overrideAccess: true,
        trash: true,
        where: { id: { in: [almanac.id, reprint.id] } }
      })

      const [refused, restored] = errors[0]?.id === almanac.id ? [almanac, reprint] : [reprint, almanac]
      expect(errors).toMatchObject([{ id: refused.id }])
      expect(docs.map(({ id }) => id)).toEqual([restored.id])
      expect((await readTrashed(refused.id)).deletedAt).toEqual(expect.any(String))
      expect(await findByPath({ draft: true, path: '/almanac', payload })).toMatchObject({ document: { id: restored.id } })
    })

    it('moves a document in the trash along when a document above it is renamed', async () => {
      const { payload } = test
      const manual = await create(payload, 'articles', { slug: 'manual', title: 'Manual' })
      const appendix = await create(payload, 'articles', { parent: manual.id, slug: 'appendix', title: 'Appendix' })
      await trash(appendix.id)

      await update(payload, 'articles', manual.id, { slug: 'handbook' })

      expect(await readTrashed(appendix.id)).toMatchObject({ ancestors: [manual.id], path: '/handbook/appendix' })
    })

    it('lifts the documents below a document in the trash when it is deleted for good', async () => {
      const { changes, payload } = test
      const series = await create(payload, 'articles', { slug: 'series', title: 'Series' })
      const part = await create(payload, 'articles', { parent: series.id, slug: 'part', title: 'Part' })
      await trash(series.id)
      changes.length = 0

      await payload.delete({ collection: 'articles', id: series.id, overrideAccess: true, trash: true })

      expect(await readPath(payload, 'articles', part.id)).toBe('/part')
      // The site heard of the document's own path when it went to the trash, so only the lifted one is named.
      expect(changes).toEqual([[changed(setup, 'articles', part, '/series/part', '/part')]])
    })

    it('leaves neither a document in the trash nor the document at its path out of a backfill', async () => {
      const { payload } = test
      const ledger = await create(payload, 'articles', { slug: 'ledger', title: 'Ledger' })
      await trash(ledger.id)
      await create(payload, 'pages', { slug: 'ledger', title: 'Ledger page' })

      expect((await backfillPaths({ payload })).left).toEqual([])
    })

    if (setup.localized) {
      it('refuses to take a document out of the trash when its path in another locale was taken since', async () => {
        const { payload } = test
        const story = await create(payload, 'articles', { slug: 'story', title: 'Story' })
        await update(payload, 'articles', story.id, { slug: 'saga', title: 'Saga' }, { locale: 'sv' })
        await trash(story.id)
        const taker = await create(payload, 'pages', { slug: 'legend', title: 'Legend' })
        await update(payload, 'pages', taker.id, { slug: 'saga', title: 'Sägen' }, { locale: 'sv' })

        expect(await catchFieldErrors(restore(story.id, 'published'))).toMatchObject([
          { message: 'Page "Sägen" is already at /saga in sv, so change the slug or the parent.', path: 'slug' }
        ])
      })
    }
  }
)
