import { postgresAdapter, sql as postgresSql } from '@payloadcms/db-postgres'
import { sqliteAdapter, sql as sqliteSql } from '@payloadcms/db-sqlite'
import {
  buildConfig,
  type CollectionConfig,
  type FieldHook,
  type FilterOptions,
  type FilterOptionsProps,
  type RelationshipField,
  type TextField,
  type Where
} from 'payload'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { pathPlugin, type PathCollection } from '../src/index.js'

const collection = (slug: string, fields: CollectionConfig['fields'] = []): CollectionConfig => ({ slug, fields })

type Config = Parameters<typeof buildConfig>[0]

const configWith = (
  collections: CollectionConfig[],
  options: Parameters<typeof pathPlugin>[0],
  localization?: Config['localization']
) => buildConfig({ collections, localization, plugins: [pathPlugin(options)], secret: 'path-tests' } as Config)

type BuiltConfig = Awaited<ReturnType<typeof configWith>>

// The named fields of a built collection, which hold the ones Payload adds itself.
const fieldsOf = (config: BuiltConfig, slug: string) =>
  (config.collections.find((built) => built.slug === slug)?.fields ?? []).flatMap((field) => ('name' in field ? [field] : []))

const fieldNamesOf = (config: BuiltConfig, slug: string) => fieldsOf(config, slug).map(({ name }) => name)

describe('pathPlugin', () => {
  it('refuses a collection the config does not have', async () => {
    await expect(
      configWith([collection('pages')], { collections: ['pages', { basePath: '/blog', slug: 'posts' }] })
    ).rejects.toThrow("@payloadpack/path was given collections the config doesn't have: posts.")
  })

  it('refuses a collection it is given more than once', async () => {
    await expect(
      configWith([collection('pages'), collection('posts')], {
        collections: ['pages', 'posts', { basePath: '/pages', slug: 'pages' }]
      })
    ).rejects.toThrow('@payloadpack/path was given pages more than once, so list each collection once.')
  })

  it.each([
    { database: 'Postgres', db: postgresAdapter({ pool: { connectionString: 'postgres://never-opened' } }), sql: postgresSql },
    { database: 'SQLite', db: sqliteAdapter({ client: { url: 'file:never-opened.db' } }), sql: sqliteSql }
  ])('refuses a site on $database that gives it no sql, and takes one that does', async ({ db, sql }) => {
    const configOn = (options: Parameters<typeof pathPlugin>[0]) =>
      buildConfig({ collections: [collection('pages')], db, plugins: [pathPlugin(options)], secret: 'path-tests' } as Config)

    await expect(configOn({ collections: ['pages'] })).rejects.toThrow(
      '@payloadpack/path needs the sql your database adapter exports on Postgres and SQLite, so import it next to the adapter and pass it to pathPlugin() as sql.'
    )
    await expect(configOn({ collections: ['pages'], sql })).resolves.toBeDefined()
  })

  it('refuses a collection with a field of its own named like one it adds', async () => {
    const pages = collection('pages', [{ name: 'slug', type: 'text' }])

    await expect(configWith([pages], { collections: ['pages'] })).rejects.toThrow(
      '@payloadpack/path adds slug to pages, so remove its own.'
    )
  })

  it("gives each collection's parent and ancestors a relationship to its own collection", async () => {
    const config = await configWith([collection('pages'), collection('posts')], {
      collections: ['pages', { basePath: '/blog', slug: 'posts' }]
    })

    const findField = (slug: string, name: string) =>
      config.collections.find((built) => built.slug === slug)?.fields.find((field) => 'name' in field && field.name === name)
    // Payload labels the parent from its name, and keeps the ancestors out of the admin panel only.
    for (const slug of ['pages', 'posts']) {
      expect(findField(slug, 'ancestors')).not.toHaveProperty('hidden', true)
      expect(findField(slug, 'parent')).toMatchObject({ label: 'Parent', relationTo: slug })
      expect(findField(slug, 'ancestors')).toMatchObject({
        admin: { disabled: true },
        hasMany: true,
        index: true,
        maxDepth: 0,
        relationTo: slug
      })
    }
  })

  it('gives a collection without a parent a slug and a path, and neither a parent nor ancestors', async () => {
    const config = await configWith([collection('pages'), collection('posts')], {
      collections: ['pages', { basePath: '/blog', parent: false, slug: 'posts' }]
    })

    expect(fieldNamesOf(config, 'posts')).toEqual(expect.arrayContaining(['slug', 'path']))
    expect(fieldNamesOf(config, 'posts')).not.toContain('parent')
    expect(fieldNamesOf(config, 'posts')).not.toContain('ancestors')
  })

  it.each<[string, Partial<CollectionConfig>, string]>([
    ['hierarchy', { hierarchy: true }, '_h_pages'],
    ["hierarchy with a parent field named like the plugin's own", { hierarchy: { parentFieldName: 'parent' } }, 'parent'],
    ['folders preset', { folders: true }, '_h_pages'],
    ['tags preset', { tags: true }, '_h_pages']
  ])("leaves the parent of a collection with Payload's %s to Payload's own field", async (_label, hierarchy, parentField) => {
    const config = await configWith([{ ...collection('pages'), ...hierarchy }], { collections: ['pages'] })

    // Payload's own parent field holds one parent by name, where the plugin's own leaves hasMany out.
    const parents = fieldsOf(config, 'pages').filter(({ name }) => name === parentField || name === 'parent')
    expect(parents).toMatchObject([{ hasMany: false, name: parentField, relationTo: 'pages' }])
    expect(fieldNamesOf(config, 'pages')).toEqual(expect.arrayContaining(['slug', 'path', 'ancestors']))
  })

  it("adds neither a parent nor ancestors to a collection with Payload's hierarchy and without a parent", async () => {
    const config = await configWith([{ ...collection('pages'), hierarchy: true }], {
      collections: [{ parent: false, slug: 'pages' }]
    })

    expect(fieldNamesOf(config, 'pages')).toEqual(expect.arrayContaining(['_h_pages', 'slug', 'path']))
    expect(fieldNamesOf(config, 'pages')).not.toContain('parent')
    expect(fieldNamesOf(config, 'pages')).not.toContain('ancestors')
  })

  it('takes false alone as the parent of a collection', () => {
    expectTypeOf<Exclude<PathCollection, string>>().toHaveProperty('parent').toEqualTypeOf<false | undefined>()
  })

  it('gives a collection given with localized: true a slug and a path per locale, and the others one of each', async () => {
    const config = await configWith(
      [collection('pages'), collection('products')],
      { collections: [{ localized: true, slug: 'pages' }, 'products'] },
      { defaultLocale: 'en', locales: ['en', 'sv'] }
    )

    const localizedOf = (slug: string) =>
      ['slug', 'path'].map((name) =>
        fieldsOf(config, slug).some((field) => field.name === name && 'localized' in field && field.localized)
      )
    expect(localizedOf('pages')).toEqual([true, true])
    expect(localizedOf('products')).toEqual([false, false])
  })

  it('takes true alone as localized of a collection', () => {
    expectTypeOf<Exclude<PathCollection, string>>().toHaveProperty('localized').toEqualTypeOf<true | undefined>()
  })

  it("shows the slug as Payload's slug field, which makes a slug from the title with the site's own slugify", async () => {
    const slugify = () => 'made-by-the-site'
    const pages: CollectionConfig = { ...collection('pages', [{ name: 'title', type: 'text' }]), admin: { useAsTitle: 'title' } }
    const config = await configWith([pages, collection('posts')], { collections: ['pages', 'posts'], slugify })

    const slugOf = (slug: string) =>
      config.collections.find((built) => built.slug === slug)?.fields.find((field) => 'name' in field && field.name === 'slug')
    const component = (useAsSlug: string | undefined) => ({
      clientProps: { useAsSlug },
      path: '@payloadpack/path/client#SlugField'
    })
    // Payload's slugify server function, which the refresh button calls, runs the field's custom.slugify.
    expect(slugOf('pages')).toMatchObject({
      admin: { components: { Field: component('title') } },
      custom: { slugify },
      type: 'text'
    })
    // A collection without a title field has nothing to make a slug from.
    expect(slugOf('posts')).toMatchObject({ admin: { components: { Field: component(undefined) } }, custom: { slugify } })
  })

  // The slug field and parent field of pages, given with what a site sets on them.
  const fieldsGiven = async (given: Omit<Extract<PathCollection, { slug: string }>, 'slug'>) => {
    const config = await configWith([collection('pages')], { collections: [{ ...given, slug: 'pages' } as PathCollection] })
    const find = (name: string) => fieldsOf(config, 'pages').find((field) => field.name === name)
    return { parent: find('parent') as RelationshipField, slug: find('slug') as TextField }
  }

  it('puts the access, label and validate a site sets on the slug field and the parent field on them as they are', async () => {
    const access = { update: () => true }
    const validate = () => true as const
    const { parent, slug } = await fieldsGiven({
      parentField: { access, label: 'Sits below' },
      slugField: { access, label: 'URL segment', validate }
    })

    expect(slug).toMatchObject({ access, label: 'URL segment', name: 'slug', type: 'text' })
    expect(slug.validate).toBe(validate)
    expect(parent).toMatchObject({ access, index: true, label: 'Sits below', name: 'parent', relationTo: 'pages' })
  })

  it("keeps the plugin's slug component and sidebar position under the admin a site sets, unless it sets its own", async () => {
    const { parent, slug } = await fieldsGiven({
      parentField: { admin: { allowCreate: false } },
      slugField: { admin: { components: { Description: './description#Description' }, description: 'Ask the web team first.' } }
    })
    const { slug: placed } = await fieldsGiven({
      slugField: { admin: { components: { Field: './slug#Slug' }, position: undefined } }
    })

    expect(slug.admin).toMatchObject({
      components: {
        Description: './description#Description',
        Field: { path: '@payloadpack/path/client#SlugField' }
      },
      description: 'Ask the web team first.',
      position: 'sidebar'
    })
    expect(parent.admin).toMatchObject({ allowCreate: false, position: 'sidebar' })
    expect(placed.admin).toMatchObject({ components: { Field: './slug#Slug' } })
    expect(placed.admin?.position).toBeUndefined()
  })

  it("adds the hooks a site sets on the slug field after the plugin's own, and the ones on the parent field as they are", async () => {
    const hook: FieldHook = ({ value }) => value
    const { parent, slug } = await fieldsGiven({
      parentField: { hooks: { beforeChange: [hook] } },
      slugField: { hooks: { afterRead: [hook], beforeDuplicate: [hook], beforeValidate: [hook] } }
    })

    // The plugin's own hook comes first: what the slug is cleaned and copied by.
    expect(slug.hooks).toMatchObject({
      afterRead: [hook],
      beforeDuplicate: [expect.any(Function), hook],
      beforeValidate: [expect.any(Function), hook]
    })
    expect(slug.hooks?.beforeValidate?.[0]).not.toBe(hook)
    expect(parent.hooks).toEqual({ beforeChange: [hook] })
  })

  it.each<[string, FilterOptions, Where | false]>([
    [
      'a where',
      { title: { exists: true } },
      { and: [{ id: { not_equals: 7 }, path: { not_equals: '/' } }, { title: { exists: true } }] }
    ],
    [
      'a function that gives a where',
      ({ id }) => ({ title: { not_equals: String(id) } }),
      { and: [{ id: { not_equals: 7 }, path: { not_equals: '/' } }, { title: { not_equals: '7' } }] }
    ],
    [
      'an async function that gives a where',
      async () => ({ title: { exists: true } }),
      { and: [{ id: { not_equals: 7 }, path: { not_equals: '/' } }, { title: { exists: true } }] }
    ],
    ['a function that gives true', () => true, { id: { not_equals: 7 }, path: { not_equals: '/' } }],
    ['a function that gives false', async () => false, false],
    ['null', null, { id: { not_equals: 7 }, path: { not_equals: '/' } }]
  ])("holds the parent filter a site sets as %s together with the plugin's own", async (_label, filterOptions, expected) => {
    const { parent } = await fieldsGiven({ parentField: { filterOptions } })

    const run = parent.filterOptions as (options: FilterOptionsProps) => Promise<false | Where>
    expect(await run({ id: 7, relationTo: 'pages' } as FilterOptionsProps)).toEqual(expected)
  })

  it.each<[string, Partial<CollectionConfig>, PathCollection]>([
    // The type refuses it too, as the next test shows, so the site here is one without types.
    ['without a parent', {}, { parent: false, parentField: { label: 'Parent' }, slug: 'pages' } as unknown as PathCollection],
    ["with Payload's hierarchy", { hierarchy: true }, { parentField: { label: 'Parent' }, slug: 'pages' }]
  ])('refuses parentField for a collection %s', async (_label, own, given) => {
    await expect(configWith([{ ...collection('pages'), ...own }], { collections: [given] })).rejects.toThrow(
      '@payloadpack/path adds no parent field to pages, so leave out its parentField.'
    )
  })

  it('takes parentField only for a collection with a parent', () => {
    expectTypeOf<{ parentField: { label: string }; slug: 'pages' }>().toExtend<PathCollection>()
    expectTypeOf<{ parent: false; parentField: { label: string }; slug: 'pages' }>().not.toExtend<PathCollection>()
  })

  it.each([
    ['blog', "doesn't start with a slash, so start it with one"],
    ['/blog/', 'ends with a slash, so remove that slash'],
    ['/blog//news', 'has an empty segment, so remove the extra slash'],
    ['/', 'is the root already, so leave basePath out']
  ])('refuses the base path %s', async (basePath, refusal) => {
    await expect(
      configWith([collection('pages'), collection('posts')], { collections: ['pages', { basePath, slug: 'posts' }] })
    ).rejects.toThrow(`@payloadpack/path was given the base path ${basePath} for posts, which ${refusal}.`)
  })
})
