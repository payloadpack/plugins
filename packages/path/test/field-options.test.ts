import type { CollectionSlug, FieldAccess, FieldHook, FilterOptionsProps, RelationshipField, User, Where } from 'payload'
import { beforeAll, expect, it } from 'vitest'

import type { PathCollection } from '../src/index.js'
import type { Id } from '../src/path/build-path-and-ancestors.js'
import { describeEachSetup, titled } from './support/boot-payload.js'
import { catchFieldErrors, create, readDocument, update } from './support/documents.js'
import { LOCALES } from './support/setups.js'

// A site where only a save in the default locale changes a slug, with Payload's own field access.
const inDefaultLocaleOnly: FieldAccess = ({ req }) => req.locale === 'en'

// Manuals offer only a published manual as a parent.
const PUBLISHED: Where = { _status: { equals: 'published' } }

// The slugs a site's own hook on the leaflets' slug field was given.
const seenSlugs: unknown[] = []
const seeSlug: FieldHook = ({ value }) => {
  seenSlugs.push(value)
  return value
}

// Manuals have a slug per locale, and leaflets one slug in every locale.
const GIVEN: PathCollection[] = [
  {
    localized: true,
    parentField: { filterOptions: () => PUBLISHED },
    slug: 'manuals',
    slugField: { access: { update: inDefaultLocaleOnly } }
  },
  { slug: 'leaflets', slugField: { access: { update: inDefaultLocaleOnly }, hooks: { beforeValidate: [seeSlug] } } }
]

describeEachSetup(
  'with options for the slug field and the parent field',
  {
    // Every setup has locales, so a save can be made in another locale than the default one.
    boot: (setup) => ({
      collections: [
        { slug: 'users', auth: true, fields: [] },
        titled('manuals', setup.localized),
        titled('leaflets', setup.localized)
      ],
      localization: { defaultLocale: 'en', fallback: true, locales: LOCALES },
      notLocalized: ['leaflets'],
      options: { collections: GIVEN }
    })
  },
  (test) => {
    // An editor, whose saves Payload checks against the access of each field.
    let editor: User
    beforeAll(async () => {
      const user = await test.payload.create({
        collection: 'users',
        data: { email: 'editor@example.com', password: 'editor-password' },
        overrideAccess: true
      })
      editor = { ...user, collection: 'users' } as User
    })

    const saveAsEditor = (collection: CollectionSlug, id: Id, data: Record<string, unknown>, locale: string) =>
      test.payload.update({
        collection,
        data: { _status: 'published', ...data },
        id,
        locale,
        overrideAccess: false,
        user: editor
      })

    const readIn = (collection: CollectionSlug, id: Id, locale: string) => readDocument(test.payload, collection, id, { locale })

    it.each<[string, CollectionSlug]>([
      ['a slug per locale', 'manuals'],
      ['one slug in every locale', 'leaflets']
    ])(
      'keeps the slug and the path when an editor saves another slug in another locale, with %s, and saves the rest, and moves the document on a save in the default locale',
      async (_label, collection) => {
        const lantern = await create(test.payload, collection, { slug: `${collection}-lantern`, title: 'Lantern' })

        await saveAsEditor(collection, lantern.id, { slug: `${collection}-lykta`, title: 'Lykta' }, 'sv')

        for (const locale of LOCALES) {
          expect(await readIn(collection, lantern.id, locale)).toMatchObject({
            path: `/${collection}-lantern`,
            slug: `${collection}-lantern`
          })
        }
        expect(await readIn(collection, lantern.id, 'sv')).toMatchObject({ title: 'Lykta' })

        await saveAsEditor(collection, lantern.id, { slug: `${collection}-lamp` }, 'en')

        expect(await readIn(collection, lantern.id, 'en')).toMatchObject({
          path: `/${collection}-lamp`,
          slug: `${collection}-lamp`
        })
      }
    )

    it("keeps a document's own slug in another locale when an editor saves another slug there", async () => {
      const { payload } = test
      const compass = await create(payload, 'manuals', { slug: 'compass', title: 'Compass' })
      await update(payload, 'manuals', compass.id, { slug: 'kompass' }, { locale: 'sv' })

      await saveAsEditor('manuals', compass.id, { slug: 'riktning', title: 'Kompass' }, 'sv')

      expect(await readIn('manuals', compass.id, 'sv')).toMatchObject({ path: '/kompass', slug: 'kompass', title: 'Kompass' })
      expect(await readIn('manuals', compass.id, 'en')).toMatchObject({ path: '/compass', slug: 'compass' })
    })

    it("gives a site's own hook on the slug field the slug the plugin cleaned", async () => {
      seenSlugs.length = 0

      await create(test.payload, 'leaflets', { slug: 'Tide Tables', title: 'Tide tables' })

      expect(seenSlugs).toEqual(['tide-tables'])
    })

    it("offers as a parent only what the site's filter and the plugin's both let through, and refuses another on a save", async () => {
      const { payload } = test
      const home = await create(payload, 'manuals', { slug: 'home', title: 'Home' })
      const shelf = await create(payload, 'manuals', { slug: 'shelf', title: 'Shelf' })
      const sketch = await create(payload, 'manuals', { slug: 'sketch', title: 'Sketch' }, { draft: true })
      const binder = await create(payload, 'manuals', { slug: 'binder', title: 'Binder' })
      const { filterOptions } = payload.collections.manuals.config.fields.find(
        (field) => 'name' in field && field.name === 'parent'
      ) as RelationshipField
      // The documents of this test the picker offers to the binder.
      const where = (await (filterOptions as (options: FilterOptionsProps) => unknown)({
        id: binder.id,
        relationTo: 'manuals'
      } as FilterOptionsProps)) as Where
      const { docs } = await payload.find({
        collection: 'manuals',
        depth: 0,
        overrideAccess: true,
        pagination: false,
        where: { and: [where, { id: { in: [home.id, shelf.id, sketch.id, binder.id] } }] }
      })

      expect(docs.map(({ id }) => id)).toEqual([shelf.id])
      // Payload checks a chosen parent against the picker's filter.
      expect(await catchFieldErrors(update(payload, 'manuals', binder.id, { parent: sketch.id }))).toMatchObject([
        { message: expect.stringContaining('invalid selections'), path: 'parent' }
      ])
    })
  }
)
