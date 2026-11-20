import { commitTransaction, createPayloadRequest, initTransaction } from 'payload'
import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { create, remove, store, update } from './support/documents.js'
import { listIndexes, readSqlitePlan } from './support/raw-access.js'
import { SETUPS } from './support/setups.js'

// The promises about speed: a site finds the document at a path with one indexed query per
// collection, and a move runs the same statements whatever the size of its branch. How many that is
// is not pinned.
describeEachSetup(
  '',
  // The plugin is given pages and posts, so a query per collection is two.
  { boot: { options: { collections: ['pages', 'posts'] } } },
  (test, setup) => {
    it('keeps an index on the path of each collection', async () => {
      for (const collection of ['pages', 'posts']) {
        const indexes = await listIndexes(test, setup, collection)
        const pathIndexes =
          setup.database === 'mongodb'
            ? setup.localized
              ? [`${collection}(path.en)`, `${collection}(path.sv)`]
              : [`${collection}(path)`]
            : [setup.localized ? `${collection}_locales(path,_locale)` : `${collection}(path)`]
        expect(indexes).toEqual(expect.arrayContaining(pathIndexes))
      }
    })

    it('keeps an index on the ancestors of each collection and of its versions, where a move looks up its branch', async () => {
      for (const collection of ['pages', 'posts']) {
        const [indexes, versionIndexes] =
          setup.database === 'mongodb'
            ? [`${collection}(ancestors)`, `_${collection}_versions(version.ancestors)`]
            : [`${collection}_rels(${collection}_id)`, `_${collection}_v_rels(${collection}_id)`]
        const versions = setup.database === 'mongodb' ? `_${collection}_versions` : `_${collection}_v`
        expect(await listIndexes(test, setup, collection)).toContain(indexes)
        expect(await listIndexes(test, setup, versions)).toContain(versionIndexes)
      }
    })

    it('finds a path with one query per collection', async () => {
      const { payload } = test
      const missing = await test.countQueries(() => findByPath({ path: '/shop/nothing', payload }))

      expect(missing.map(({ collection }) => collection)).toEqual(['pages', 'posts'])
    })

    it('finds a path with a reserved segment without a query', async () => {
      const { payload } = test
      const reserved = await test.countQueries(async () => {
        expect(await findByPath({ path: '/admin/collections/pages', payload })).toBeNull()
        expect(await findByPath({ path: '/journal/-/page/2', payload })).toBeNull()
      })

      expect(reserved).toEqual([])
    })

    // Each branch fits in a chunk: one document right below the top, and the others below that one.
    it('runs the same statements to rename, move or delete a document with 30 below as with 3 below', async () => {
      const { payload } = test
      const readStatements = async (size: number) => {
        const other = await create(payload, 'pages', { slug: `other-${size}`, title: 'Other' })
        const changes = {
          delete: (top: Id) => remove(payload, 'pages', top),
          move: (top: Id) => update(payload, 'pages', top, { parent: other.id }),
          rename: (top: Id) => update(payload, 'pages', top, { slug: `rename-${size}-renamed` })
        }
        const statements: Record<string, string[]> = {}
        for (const [name, change] of Object.entries(changes)) {
          const top = await create(payload, 'pages', { slug: `${name}-${size}`, title: 'Top' })
          const first = await create(payload, 'pages', { parent: top.id, slug: `${name}-${size}-first`, title: 'First' })
          // The others are stored in one transaction, with what a save would give them.
          const req = await createPayloadRequest({ payload })
          await initTransaction(req)
          for (let number = 1; number < size; number++) {
            const slug = `below-${number}`
            const path = `/${name}-${size}/${name}-${size}-first/${slug}`
            await store({ payload, req }, setup, 'pages', {
              ancestors: [top.id, first.id],
              parent: first.id,
              path: setup.localized ? { en: path, sv: path } : path,
              slug,
              title: 'Below'
            })
          }
          await commitTransaction(req)
          const queries = await test.countQueries(() => change(top.id))
          statements[name] = queries.map(({ collection, operation }) => `${operation} ${collection}`)
        }
        return statements
      }

      expect(await readStatements(30)).toEqual(await readStatements(3))
    })
  }
)

// SQLite keeps no statistics, so the index it reads depends on the query alone. A lookup that also
// asked which status a document has, or named the trash, would let it read their index instead, and
// with it every published document of the collection.
describeEachSetup(
  'which picks an index by the query alone',
  {
    boot: (setup) => ({
      collections: [{ ...titled('articles', setup.localized), trash: true }],
      options: { collections: ['pages', 'articles'] }
    }),
    setups: SETUPS.filter(({ database }) => database === 'sqlite')
  },
  (test) => {
    it('finds a path on the path index, in a collection with drafts and in one with a trash too', async () => {
      const { payload } = test
      const lookup = await test.countQueries(() => findByPath({ path: '/shop/nothing', payload }))

      expect(lookup.map(({ collection }) => collection)).toEqual(['pages', 'articles'])
      for (const query of lookup) {
        expect(await readSqlitePlan(test, query)).toContainEqual(
          expect.stringContaining(`USING INDEX ${query.collection}_path_idx`)
        )
      }
    })
  }
)
