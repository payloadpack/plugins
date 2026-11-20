import { beforeEach, expect, it } from 'vitest'

import { backfillPaths, findByPath } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, changed, create, readDocument, readPath, remove, store, update } from './support/documents.js'

const HIERARCHIES = [
  { hierarchy: true, label: "with Payload's hierarchy", parentField: '_h_topics' },
  {
    hierarchy: { parentFieldName: 'section' },
    label: "with Payload's hierarchy and a parent field the site names",
    parentField: 'section'
  }
]

for (const { hierarchy, label, parentField } of HIERARCHIES) {
  describeEachSetup(
    label,
    {
      boot: (setup) => ({
        collections: [{ ...titled('topics', setup.localized), hierarchy }],
        options: { collections: ['pages', 'topics'] }
      })
    },
    (test, setup) => {
      beforeEach(() => {
        test.changes.length = 0
      })

      // A topic's parent, in the field Payload's hierarchy holds it in.
      const below = ({ id }: { id: Id }) => ({ [parentField]: id })

      it("makes a path from the parent Payload's own field holds, with the ancestors", async () => {
        const { payload } = test
        const science = await create(payload, 'topics', { slug: 'science', title: 'Science' })
        const physics = await create(payload, 'topics', { ...below(science), slug: 'physics', title: 'Physics' })
        const optics = await create(payload, 'topics', { ...below(physics), slug: 'optics', title: 'Optics' })

        expect(await readDocument(payload, 'topics', optics.id)).toMatchObject({
          ancestors: [science.id, physics.id],
          path: '/science/physics/optics'
        })
        expect(await findByPath({ path: '/science/physics', payload })).toMatchObject({
          collection: 'topics',
          document: { id: physics.id }
        })
      })

      it('gives every topic below a renamed topic its new path, latest versions too', async () => {
        const { payload } = test
        const history = await create(payload, 'topics', { slug: 'history', title: 'History' })
        const ancient = await create(payload, 'topics', { ...below(history), slug: 'ancient', title: 'Ancient' })
        const rome = await create(payload, 'topics', { ...below(ancient), slug: 'rome', title: 'Rome' })

        await update(payload, 'topics', history.id, { slug: 'past' })

        for (const draft of [false, true]) {
          expect(await readPath(payload, 'topics', ancient.id, { draft })).toBe('/past/ancient')
          expect(await readPath(payload, 'topics', rome.id, { draft })).toBe('/past/ancient/rome')
        }
      })

      it('moves a topic and everything below it to a new parent, latest versions too, and reports the move', async () => {
        const { changes, payload } = test
        const arts = await create(payload, 'topics', { slug: 'arts', title: 'Arts' })
        const crafts = await create(payload, 'topics', { slug: 'crafts', title: 'Crafts' })
        const pottery = await create(payload, 'topics', { ...below(crafts), slug: 'pottery', title: 'Pottery' })
        const glazes = await create(payload, 'topics', { ...below(pottery), slug: 'glazes', title: 'Glazes' })
        await update(payload, 'topics', glazes.id, { slug: 'glazing' }, { draft: true })
        changes.length = 0

        await update(payload, 'topics', crafts.id, below(arts))

        expect(await readDocument(payload, 'topics', pottery.id)).toMatchObject({
          ancestors: [arts.id, crafts.id],
          path: '/arts/crafts/pottery'
        })
        expect(await readPath(payload, 'topics', glazes.id)).toBe('/arts/crafts/pottery/glazes')
        expect(await readDocument(payload, 'topics', glazes.id, { draft: true })).toMatchObject({
          ancestors: [arts.id, crafts.id, pottery.id],
          path: '/arts/crafts/pottery/glazing'
        })
        expect(changes).toEqual([
          [
            changed(setup, 'topics', crafts, '/crafts', '/arts/crafts'),
            changed(setup, 'topics', pottery, '/crafts/pottery', '/arts/crafts/pottery'),
            // The topic with a renamed draft is named at the path it is published at.
            changed(setup, 'topics', glazes, '/crafts/pottery/glazes', '/arts/crafts/pottery/glazes')
          ]
        ])
      })

      it('keeps a new parent in a draft of a published topic pending until it is published', async () => {
        const { changes, payload } = test
        const trades = await create(payload, 'topics', { slug: 'trades', title: 'Trades' })
        const guilds = await create(payload, 'topics', { slug: 'guilds', title: 'Guilds' })
        const masons = await create(payload, 'topics', { ...below(guilds), slug: 'masons', title: 'Masons' })
        const lodges = await create(payload, 'topics', { ...below(masons), slug: 'lodges', title: 'Lodges' })
        changes.length = 0

        await update(payload, 'topics', masons.id, below(trades), { draft: true })

        const published = await readDocument(payload, 'topics', masons.id)
        expect(published.path).toBe('/guilds/masons')
        expect(String(published[parentField])).toBe(String(guilds.id))
        expect(await readPath(payload, 'topics', masons.id, { draft: true })).toBe('/trades/masons')
        expect(await readPath(payload, 'topics', lodges.id)).toBe('/guilds/masons/lodges')
        expect(changes).toEqual([])

        await update(payload, 'topics', masons.id, {})

        expect(await readPath(payload, 'topics', masons.id)).toBe('/trades/masons')
        expect(await readDocument(payload, 'topics', lodges.id)).toMatchObject({
          ancestors: [trades.id, masons.id],
          path: '/trades/masons/lodges'
        })
      })

      it('gives a topic that is not published the parent its draft moves it below, so a delete of the old parent leaves it', async () => {
        const { payload } = test
        const metals = await create(payload, 'topics', { slug: 'metals', title: 'Metals' })
        const alloys = await create(payload, 'topics', { slug: 'alloys', title: 'Alloys' })
        const brass = await create(payload, 'topics', { ...below(metals), slug: 'brass', title: 'Brass' }, { draft: true })

        // Payload writes a draft to the latest version only, and deletes with a topic every topic that
        // itself holds it as its parent.
        await update(payload, 'topics', brass.id, below(alloys), { draft: true })

        const moved = await readDocument(payload, 'topics', brass.id)
        expect(moved).toMatchObject({ ancestors: [alloys.id], path: '/alloys/brass' })
        expect(String(moved[parentField])).toBe(String(alloys.id))

        await remove(payload, 'topics', metals.id)

        expect(await readDocument(payload, 'topics', brass.id)).toMatchObject({ ancestors: [alloys.id], path: '/alloys/brass' })
      })

      it('moves a topic below one that is not published and that a draft moved out of it', async () => {
        const { payload } = test
        const tools = await create(payload, 'topics', { slug: 'tools', title: 'Tools' })
        const lathes = await create(payload, 'topics', { ...below(tools), slug: 'lathes', title: 'Lathes' }, { draft: true })
        await update(payload, 'topics', lathes.id, { [parentField]: null }, { draft: true })

        // Payload's own check walks the parents the topics themselves hold.
        await update(payload, 'topics', tools.id, below(lathes))

        expect(await readDocument(payload, 'topics', tools.id)).toMatchObject({ ancestors: [lathes.id], path: '/lathes/tools' })
      })

      it('lifts the topics below a deleted topic one level, deletes none of them, and reports the lift', async () => {
        const { changes, payload } = test
        const sports = await create(payload, 'topics', { slug: 'sports', title: 'Sports' })
        const ballGames = await create(payload, 'topics', { ...below(sports), slug: 'ball-games', title: 'Ball games' })
        const tennis = await create(payload, 'topics', { ...below(ballGames), slug: 'tennis', title: 'Tennis' })
        const serve = await create(payload, 'topics', { ...below(tennis), slug: 'serve', title: 'Serve' })
        const golf = await create(payload, 'topics', { ...below(ballGames), slug: 'golf', title: 'Golf' })
        await update(payload, 'topics', golf.id, { slug: 'links' }, { draft: true })
        changes.length = 0

        await remove(payload, 'topics', ballGames.id)

        const lifted = await readDocument(payload, 'topics', tennis.id)
        expect(lifted).toMatchObject({ ancestors: [sports.id], path: '/sports/tennis' })
        expect(String(lifted[parentField])).toBe(String(sports.id))
        expect(await readDocument(payload, 'topics', serve.id)).toMatchObject({
          ancestors: [sports.id, tennis.id],
          path: '/sports/tennis/serve'
        })
        expect(await readPath(payload, 'topics', golf.id)).toBe('/sports/golf')
        const draft = await readDocument(payload, 'topics', golf.id, { draft: true })
        expect(draft.path).toBe('/sports/links')
        expect(String(draft[parentField])).toBe(String(sports.id))
        expect(changes).toEqual([
          [
            changed(setup, 'topics', ballGames, '/sports/ball-games', null),
            changed(setup, 'topics', tennis, '/sports/ball-games/tennis', '/sports/tennis'),
            changed(setup, 'topics', golf, '/sports/ball-games/golf', '/sports/golf'),
            changed(setup, 'topics', serve, '/sports/ball-games/tennis/serve', '/sports/tennis/serve')
          ]
        ])
      })

      it('lifts the topics below a deleted top-level topic to the top level, and deletes none of them', async () => {
        const { payload } = test
        const crops = await create(payload, 'topics', { slug: 'crops', title: 'Crops' })
        const grains = await create(payload, 'topics', { ...below(crops), slug: 'grains', title: 'Grains' })
        const barley = await create(payload, 'topics', { ...below(grains), slug: 'barley', title: 'Barley' })

        await remove(payload, 'topics', crops.id)

        const lifted = await readDocument(payload, 'topics', grains.id)
        expect(lifted).toMatchObject({ ancestors: [], path: '/grains' })
        expect(lifted[parentField] ?? null).toBeNull()
        expect(await readPath(payload, 'topics', barley.id)).toBe('/grains/barley')
      })

      it('refuses a delete that would lift a topic onto a taken path, and deletes nothing', async () => {
        const { payload } = test
        await create(payload, 'topics', { slug: 'chess', title: 'Chess' })
        const games = await create(payload, 'topics', { slug: 'games', title: 'Games' })
        const variants = await create(payload, 'topics', { ...below(games), slug: 'chess', title: 'Chess variants' })

        expect(await catchFieldErrors(remove(payload, 'topics', games.id))).toMatchObject([
          { message: 'Topic "Chess" is already at /chess, so change the slug or the parent.', path: 'slug' }
        ])
        expect(await readPath(payload, 'topics', games.id)).toBe('/games')
        expect(await readPath(payload, 'topics', variants.id)).toBe('/games/chess')
      })

      it('refuses a parent a topic cannot sit below, on the slug, since the form has no field for the parent', async () => {
        const { payload } = test
        const home = await create(payload, 'topics', { slug: 'home', title: 'Home' })
        const maths = await create(payload, 'topics', { slug: 'maths', title: 'Maths' })
        const algebra = await create(payload, 'topics', { ...below(maths), slug: 'algebra', title: 'Algebra' })
        const unnamed = await create(payload, 'topics', {}, { draft: true })
        const belowItself = [{ message: "A document can't sit below itself, so pick another parent.", path: 'slug' }]

        expect(await catchFieldErrors(update(payload, 'topics', maths.id, below(maths)))).toMatchObject(belowItself)
        expect(await catchFieldErrors(update(payload, 'topics', maths.id, below(algebra)))).toMatchObject(belowItself)
        expect(
          await catchFieldErrors(create(payload, 'topics', { ...below(unnamed), slug: 'geometry', title: 'Geometry' }))
        ).toMatchObject([{ message: 'The parent has no path yet, so save the parent first.', path: 'slug' }])
        expect(
          await catchFieldErrors(create(payload, 'topics', { ...below(home), slug: 'logic', title: 'Logic' }))
        ).toMatchObject([{ message: "The home page can't hold topics, so pick another parent.", path: 'slug' }])
        expect(await readPath(payload, 'topics', algebra.id)).toBe('/maths/algebra')
      })

      it('gives a duplicate below a parent the slug with -copy among the topics below that parent only', async () => {
        const { payload } = test
        const rocks = await create(payload, 'topics', { slug: 'rocks', title: 'Rocks' })
        const basalt = await create(payload, 'topics', { ...below(rocks), slug: 'basalt', title: 'Basalt' })
        // The same slug at the top level is not in the way.
        await create(payload, 'topics', { slug: 'basalt-copy', title: 'Basalt copy' })
        const duplicate = () => payload.duplicate({ collection: 'topics', draft: true, id: basalt.id, overrideAccess: true })

        const copies = [await duplicate(), await duplicate()]

        expect(copies.map(({ path }) => path)).toEqual(['/rocks/basalt-copy', '/rocks/basalt-copy-2'])
      })

      it('gives the topics a site already had their paths and ancestors', async () => {
        const { payload } = test
        const rivers = await store(test, setup, 'topics', { slug: 'rivers', title: 'Rivers' })
        const deltas = await store(test, setup, 'topics', { [parentField]: rivers, slug: 'deltas', title: 'Deltas' })

        const report = await backfillPaths({ collections: ['topics'], payload })

        expect(report.updated).toBe(2)
        for (const draft of [false, true]) {
          expect(await readDocument(payload, 'topics', deltas, { draft })).toMatchObject({
            ancestors: [rivers],
            path: '/rivers/deltas'
          })
        }
      })
    }
  )
}

describeEachSetup(
  "with Payload's folders preset",
  {
    boot: (setup) => ({
      collections: [{ ...titled('shelves', setup.localized), folders: true }],
      options: { collections: ['pages', { basePath: '/library', slug: 'shelves' }] }
    })
  },
  (test) => {
    it("makes a path from the parent the preset's own field holds", async () => {
      const { payload } = test
      const fiction = await create(payload, 'shelves', { slug: 'fiction', title: 'Fiction' })
      const crime = await create(payload, 'shelves', { _h_shelves: fiction.id, slug: 'crime', title: 'Crime' })

      expect(await readDocument(payload, 'shelves', crime.id)).toMatchObject({
        ancestors: [fiction.id],
        path: '/library/fiction/crime'
      })
    })
  }
)
