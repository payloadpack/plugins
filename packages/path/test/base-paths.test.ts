import { expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, readPath, remove, update } from './support/documents.js'

describeEachSetup(
  '',
  {
    boot: (setup) => ({
      // Feeds sit below a reserved segment, which no document of theirs can hold.
      collections: [titled('feeds', setup.localized)],
      options: { collections: ['pages', { basePath: '/blog', slug: 'posts' }, { basePath: '/api/feeds', slug: 'feeds' }] }
    })
  },
  (test) => {
    it('puts a top-level post at the base path, a slash and its slug, and finds it there', async () => {
      const { payload } = test
      const hello = await create(payload, 'posts', { slug: 'hello', title: 'Hello' })
      const more = await create(payload, 'posts', { parent: hello.id, slug: 'more', title: 'More' })
      const page = await create(payload, 'pages', { slug: 'hello', title: 'Hello page' })

      expect(await readPath(payload, 'posts', hello.id)).toBe('/blog/hello')
      expect(await readPath(payload, 'posts', more.id)).toBe('/blog/hello/more')
      expect((await readDocument(payload, 'posts', more.id)).ancestors).toEqual([hello.id])
      expect(await readPath(payload, 'pages', page.id)).toBe('/hello')
      expect(await findByPath({ path: '/blog/hello/more', payload })).toMatchObject({
        collection: 'posts',
        document: { id: more.id }
      })
      expect(await findByPath({ path: '/hello', payload })).toMatchObject({ collection: 'pages', document: { id: page.id } })
    })

    it('puts a post with the root slug below the base path, and only a page at /', async () => {
      const { payload } = test
      const homePage = await create(payload, 'pages', { slug: 'home', title: 'Home' })
      const homePost = await create(payload, 'posts', { slug: 'home', title: 'Home post' })

      expect(await readPath(payload, 'pages', homePage.id)).toBe('/')
      expect(await readPath(payload, 'posts', homePost.id)).toBe('/blog/home')
      expect(await findByPath({ path: '/blog/home', payload })).toMatchObject({
        collection: 'posts',
        document: { id: homePost.id }
      })
    })

    it('refuses a move that lands a page on a post, with no document at the new path of the moved page', async () => {
      const { payload } = test
      await create(payload, 'posts', { slug: 'recipes', title: 'Recipes post' })
      const journal = await create(payload, 'pages', { slug: 'journal', title: 'Journal' })
      const recipes = await create(payload, 'pages', { parent: journal.id, slug: 'recipes', title: 'Recipes page' })

      // No document is at /blog yet: the posts' base path holds none of its own.
      expect(await catchFieldErrors(update(payload, 'pages', journal.id, { slug: 'blog' }))).toMatchObject([
        { message: 'Post "Recipes post" is already at /blog/recipes, so change the slug or the parent.', path: 'slug' }
      ])
      expect(await readPath(payload, 'pages', journal.id)).toBe('/journal')
      expect(await readPath(payload, 'pages', recipes.id)).toBe('/journal/recipes')
    })

    it('refuses a move that lands a draft of the branch on a post, and a page of the branch on a draft post', async () => {
      const { payload } = test
      await create(payload, 'posts', { slug: 'walks', title: 'Walks post' })
      await create(payload, 'posts', { slug: 'rides', title: 'Rides post' }, { draft: true })
      const outings = await create(payload, 'pages', { slug: 'outings', title: 'Outings' })
      const walks = await create(payload, 'pages', { parent: outings.id, slug: 'walks', title: 'Walks page' }, { draft: true })
      const trips = await create(payload, 'pages', { slug: 'trips', title: 'Trips' })
      const rides = await create(payload, 'pages', { parent: trips.id, slug: 'rides', title: 'Rides page' })
      const takenAt = (document: string, path: string) => [
        { message: `${document} is already at ${path}, so change the slug or the parent.`, path: 'slug' }
      ]

      expect(await catchFieldErrors(update(payload, 'pages', outings.id, { slug: 'blog' }))).toMatchObject(
        takenAt('Post "Walks post"', '/blog/walks')
      )
      expect(await catchFieldErrors(update(payload, 'pages', trips.id, { slug: 'blog' }))).toMatchObject(
        takenAt('Post "Rides post"', '/blog/rides')
      )
      expect(await readPath(payload, 'pages', walks.id, { draft: true })).toBe('/outings/walks')
      expect(await readPath(payload, 'pages', rides.id)).toBe('/trips/rides')
    })

    it('refuses a save at a path a document of another collection holds through the base path', async () => {
      const { payload } = test
      const blog = await create(payload, 'pages', { slug: 'blog', title: 'Blog' })
      await create(payload, 'pages', { parent: blog.id, slug: 'launch', title: 'Launch page' })
      await create(payload, 'posts', { slug: 'spring', title: 'Spring' })

      expect(await catchFieldErrors(create(payload, 'posts', { slug: 'launch', title: 'Launch post' }))).toMatchObject([
        { message: 'Page "Launch page" is already at this path, so change the slug or the parent.', path: 'slug' }
      ])
      expect(
        await catchFieldErrors(create(payload, 'pages', { parent: blog.id, slug: 'spring', title: 'Spring page' }))
      ).toMatchObject([{ message: 'Post "Spring" is already at this path, so change the slug or the parent.', path: 'slug' }])
    })

    it('moves and lifts the posts below a post, under the base path', async () => {
      const { payload } = test
      const series = await create(payload, 'posts', { slug: 'series', title: 'Series' })
      const part = await create(payload, 'posts', { parent: series.id, slug: 'part-one', title: 'Part one' })
      const notes = await create(payload, 'posts', { parent: part.id, slug: 'notes', title: 'Notes' })

      await update(payload, 'posts', series.id, { slug: 'saga' })
      expect(await readPath(payload, 'posts', notes.id)).toBe('/blog/saga/part-one/notes')

      test.changes.length = 0
      await remove(payload, 'posts', series.id)
      expect(await readPath(payload, 'posts', part.id)).toBe('/blog/part-one')
      // The lifted posts' paths start with the base path now.
      expect(test.changes).toMatchObject([
        {
          lifted: {
            documentsBelow: 2,
            id: series.id,
            paths: expect.arrayContaining([expect.objectContaining({ from: '/blog/saga', to: '/blog' })])
          }
        }
      ])
      expect(await readPath(payload, 'posts', notes.id)).toBe('/blog/part-one/notes')
      expect((await readDocument(payload, 'posts', notes.id)).ancestors).toEqual([part.id])
    })

    it('refuses a reserved segment in the base path, as in any path', async () => {
      expect(await catchFieldErrors(create(test.payload, 'feeds', { slug: 'news', title: 'News' }))).toMatchObject([
        { message: "The site serves the CMS's API at /api, so pick another slug or a parent.", path: 'slug' }
      ])
    })
  }
)
