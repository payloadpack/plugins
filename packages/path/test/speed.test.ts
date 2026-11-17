import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { listIndexes, readSqlitePlan } from './support/raw-access.js'
import { SETUPS } from './support/setups.js'

// The one promise about speed: a site finds the document at a path with one indexed query per
// collection. What a save or a move costs is not pinned.
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
