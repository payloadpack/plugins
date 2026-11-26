import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { BlocksFeature, LinkFeature, lexicalEditor, type LexicalRichTextAdapter } from '@payloadcms/richtext-lexical'
import {
  buildConfig,
  type Block,
  type CollectionConfig,
  type Field,
  type FieldHook,
  type FilterOptions,
  type FilterOptionsProps,
  type RelationshipField,
  type TextField,
  type Where
} from 'payload'
import { generateTypes } from 'payload/node'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  getPathCollectionSlugs,
  pathPlugin,
  pathRelationshipField,
  withPath,
  type PathCollection,
  type PathCollectionOptions,
  type PathCollectionSlug
} from '../src/index.js'

const collection = (slug: string, fields: CollectionConfig['fields'] = []): CollectionConfig => ({ slug, fields })

type Config = Parameters<typeof buildConfig>[0]

const configWith = (
  collections: CollectionConfig[],
  options: Parameters<typeof pathPlugin>[0],
  localization?: Config['localization']
) => buildConfig({ collections, localization, plugins: [pathPlugin(options)], secret: 'path-tests' } as Config)

type BuiltConfig = Awaited<ReturnType<typeof configWith>>

const fieldsOf = (config: BuiltConfig, slug: string) =>
  (config.collections.find((built) => built.slug === slug)?.fields ?? []).flatMap((field) => ('name' in field ? [field] : []))

const fieldNamesOf = (config: BuiltConfig, slug: string) => fieldsOf(config, slug).map(({ name }) => name)

describe('pathPlugin', () => {
  it('refuses a collection the config does not have', async () => {
    await expect(
      configWith([collection('pages')], { collections: ['pages', { basePath: '/blog', slug: 'posts' }] })
    ).rejects.toThrow("@payloadpack/path was given collections the config doesn't have: posts.")
  })

  it.each<[string, CollectionConfig, PathCollection[]]>([
    ['twice in collections', collection('pages'), ['pages', 'posts', { basePath: '/pages', slug: 'pages' }]],
    ['in collections and with withPath', withPath(collection('pages')), ['pages', 'posts']]
  ])('refuses a collection it is given %s', async (_label, pages, collections) => {
    await expect(configWith([pages, collection('posts')], { collections })).rejects.toThrow(
      '@payloadpack/path was given pages more than once, so give each collection once, in collections or with withPath.'
    )
  })

  it('leaves the config as it is without a collection, in collections or wrapped in withPath', async () => {
    const config = { collections: [collection('pages')], secret: 'path-tests' } as Config

    expect(await pathPlugin()(config)).toBe(config)
  })

  it('gives a collection wrapped in withPath the fields its options set', async () => {
    const posts = withPath(collection('posts'), { localized: true, parent: false, slugField: { label: 'URL segment' } })
    const config = await configWith([posts], {}, { defaultLocale: 'en', locales: ['en', 'sv'] })

    expect(fieldsOf(config, 'posts')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'URL segment', localized: true, name: 'slug' }),
        expect.objectContaining({ localized: true, name: 'path' })
      ])
    )
    expect(fieldNamesOf(config, 'posts')).not.toContain('parent')
    expect(fieldNamesOf(config, 'posts')).not.toContain('ancestors')
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

  const fieldsGiven = async (given: PathCollectionOptions) => {
    const config = await configWith([collection('pages')], { collections: [{ ...given, slug: 'pages' }] })
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

  // PathCollectionSlug reads them there, so findByPath without collections is typed to these ones.
  it('names its collections, in collections or with withPath, in the types payload generate:types writes', async () => {
    const config = await buildConfig({
      collections: [collection('pages'), withPath(collection('posts')), collection('media')],
      // An adapter only for the id type the types use: nothing connects to it.
      db: sqliteAdapter({ client: { url: 'file::memory:' } }),
      plugins: [pathPlugin({ collections: ['pages'] })],
      secret: 'path-tests'
    })
    const { types } = await generateTypes(config, { log: false, returnString: true })
    expect(types).toMatch(/pathCollectionSlug: 'pages' \| 'posts';/)
  })

  it('names its collections, in collections or with withPath, to a plugin after it and in the built config', async () => {
    const slugsInPluginAfter: string[][] = []
    const config = await buildConfig({
      collections: [collection('pages'), withPath(collection('posts')), collection('media')],
      plugins: [
        pathPlugin({ collections: ['pages'] }),
        (incoming) => {
          slugsInPluginAfter.push(getPathCollectionSlugs(incoming))
          return incoming
        }
      ],
      secret: 'path-tests'
    } as Config)

    expect(slugsInPluginAfter).toEqual([['pages', 'posts']])
    expect(getPathCollectionSlugs(config)).toEqual(['pages', 'posts'])
  })

  it('asks for pathPlugin() when naming its collections in a config it has not run on', () => {
    expect(() => getPathCollectionSlugs({ collections: [withPath(collection('posts'))] } as Config)).toThrow(
      '@payloadpack/path: add pathPlugin() to the Payload config, with a collection in collections or wrapped in withPath, before calling findByPath, findPaths, backfillPaths or getPathCollectionSlugs'
    )
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

describe('pathRelationshipField', () => {
  // pathPlugin() fills a field in place, so each test builds its own.
  const linksBlock = (): Block => ({
    slug: 'links',
    fields: [{ name: 'links', type: 'array', fields: [pathRelationshipField({ name: 'doc', required: true })] }]
  })

  const fieldNamed = (fields: Field[] | undefined, name: string) =>
    fields?.find((field) => 'name' in field && field.name === name) as (Field & { fields?: Field[] }) | undefined

  const blocksOf = (field: Field | undefined) => (field && 'blocks' in field ? field.blocks : []) as Block[]

  it('points a field anywhere in the config at the collections with a path, in the order getPathCollectionSlugs gives', async () => {
    // One block in two collections is one field object, which the plugin reaches twice.
    const callToAction: Block = { slug: 'callToAction', fields: [pathRelationshipField({ name: 'target' })] }
    const layout: Field = { name: 'layout', type: 'blocks', blocks: ['links', callToAction] }
    // Lexical builds its blocks while Payload sanitizes the config, and takes one named by slug from the config's blocks.
    const body: Field = {
      name: 'body',
      type: 'richText',
      editor: lexicalEditor({ features: [BlocksFeature({ blocks: ['links'] })] })
    }
    const jobs: Config['jobs'] = {
      tasks: [{ slug: 'purge', handler: () => ({ output: {} }), inputSchema: [pathRelationshipField({ name: 'purged' })] }]
    }
    const queryPresets: Config['queryPresets'] = {
      access: {},
      constraints: {
        read: [{ access: () => true, fields: [pathRelationshipField({ name: 'shared' })], label: 'Page', value: 'page' }]
      }
    }
    const config = await buildConfig({
      admin: {
        dashboard: {
          widgets: [{ slug: 'featured', Component: './featured#Featured', fields: [pathRelationshipField({ name: 'featured' })] }]
        }
      },
      blocks: [linksBlock()],
      collections: [
        { ...collection('pages', [layout, body]), enableQueryPresets: true },
        withPath(
          collection('posts', [layout, { type: 'row', fields: [pathRelationshipField({ name: 'related', hasMany: true })] }])
        )
      ],
      globals: [
        {
          slug: 'navigation',
          fields: [
            {
              type: 'tabs',
              tabs: [
                { label: 'Main', fields: [{ name: 'menu', type: 'group', fields: [pathRelationshipField({ name: 'home' })] }] }
              ]
            }
          ]
        }
      ],
      jobs,
      plugins: [pathPlugin({ collections: ['pages'] })],
      queryPresets,
      secret: 'path-tests'
    } as Config)

    const fieldsOfCollection = (slug: string) => config.collections.find((built) => built.slug === slug)?.fields
    const callToActionIn = (slug: string) =>
      blocksOf(fieldNamed(fieldsOfCollection(slug), 'layout')).find((block) => block.slug === 'callToAction')?.fields
    const navigation = config.globals.find(({ slug }) => slug === 'navigation')?.fields[0]
    const mainTab = navigation && 'tabs' in navigation ? navigation.tabs[0]?.fields : []
    const fields = [
      fieldNamed(fieldNamed(config.blocks?.find(({ slug }) => slug === 'links')?.fields, 'links')?.fields, 'doc'),
      fieldNamed(callToActionIn('pages'), 'target'),
      fieldNamed(callToActionIn('posts'), 'target'),
      fieldNamed(fieldNamed(mainTab, 'menu')?.fields, 'home'),
      fieldNamed(fieldsOfCollection('posts')?.find((field) => field.type === 'row')?.fields, 'related'),
      fieldNamed(config.admin.dashboard?.widgets?.[0]?.fields, 'featured'),
      fieldNamed(config.jobs.tasks?.[0]?.inputSchema, 'purged'),
      fieldNamed(config.queryPresets?.constraints.read?.[0]?.fields, 'shared')
    ]

    expect(getPathCollectionSlugs(config)).toEqual(['pages', 'posts'])
    for (const field of fields) {
      expect(field).toMatchObject({ relationTo: getPathCollectionSlugs(config), type: 'relationship' })
    }
  })

  it('leaves a relationship field not made with it as it is', async () => {
    const config = await configWith(
      [
        collection('pages', [
          { name: 'author', type: 'relationship', relationTo: 'authors' },
          { name: 'pick', type: 'relationship', relationTo: ['pages'] },
          pathRelationshipField({ name: 'doc' })
        ]),
        collection('posts'),
        collection('authors')
      ],
      { collections: ['pages', 'posts'] }
    )

    const pages = config.collections.find(({ slug }) => slug === 'pages')?.fields
    expect(fieldNamed(pages, 'author')).toMatchObject({ relationTo: 'authors' })
    expect(fieldNamed(pages, 'pick')).toMatchObject({ relationTo: ['pages'] })
    expect(fieldNamed(pages, 'doc')).toMatchObject({ relationTo: ['pages', 'posts'] })
  })

  it('points a field at a list of one collection, so its value names the collection as with more', async () => {
    const config = await buildConfig({
      blocks: [linksBlock()],
      collections: [collection('pages', [{ name: 'layout', type: 'blocks', blocks: ['links'] }])],
      // An adapter only for the id type the types use: nothing connects to it.
      db: sqliteAdapter({ client: { url: 'file::memory:' } }),
      plugins: [pathPlugin({ collections: ['pages'] })],
      secret: 'path-tests'
    })
    const { types } = await generateTypes(config, { log: false, returnString: true })

    expect(fieldNamed(fieldNamed(config.blocks?.[0]?.fields, 'links')?.fields, 'doc')).toMatchObject({ relationTo: ['pages'] })
    expect(types).toMatch(/doc: \{\s*relationTo: 'pages';\s*value: number \| Page;\s*\};/)
  })

  it('refuses a field made with it in a config without a collection with a path, and names the field', () => {
    const layout: Field = { name: 'layout', type: 'blocks', blocks: ['links'] }
    const withFields = (pages: Field[]) =>
      ({
        blocks: [linksBlock()],
        collections: [collection('pages', [layout, ...pages]), collection('posts', [layout])],
        secret: 'path-tests'
      }) as Config

    expect(() => pathPlugin()(withFields([]))).toThrow(
      '@payloadpack/path was given no collection for the field doc to point at, so give pathPlugin() a collection in collections or wrapped in withPath.'
    )
    expect(() => pathPlugin()(withFields([pathRelationshipField({ name: 'related' })]))).toThrow(
      '@payloadpack/path was given no collection for the fields related and doc to point at, so give pathPlugin() a collection in collections or wrapped in withPath.'
    )
  })

  it('keeps the collections a field is given, in their order, once each has a path', async () => {
    const config = await configWith(
      [
        collection('pages', [pathRelationshipField({ name: 'doc', relationTo: ['topics', 'pages'] })]),
        collection('posts'),
        collection('topics')
      ],
      { collections: ['pages', 'posts', 'topics'] }
    )

    const pages = config.collections.find(({ slug }) => slug === 'pages')?.fields
    expect(fieldNamed(pages, 'doc')).toMatchObject({ relationTo: ['topics', 'pages'] })
  })

  it('gives a field the collections it is given at once, so a field Lexical builds after the plugin picks them too', async () => {
    // Lexical builds a link's fields while Payload sanitizes the config, after the plugin has run, and
    // gives the function the config. Its own doc field picks from every collection. The docs show this.
    const body: Field = {
      name: 'body',
      type: 'richText',
      editor: lexicalEditor({
        features: [
          LinkFeature({
            fields: ({ config, defaultFields }) =>
              defaultFields.map((field) =>
                field.type === 'relationship' && field.name === 'doc'
                  ? pathRelationshipField({
                      ...field,
                      admin: { condition: field.admin?.condition },
                      relationTo: getPathCollectionSlugs(config)
                    })
                  : field
              )
          })
        ]
      })
    }
    const config = await configWith([collection('pages', [body]), collection('posts'), collection('media')], {
      collections: ['pages', 'posts']
    })

    const { editor } = fieldNamed(config.collections.find(({ slug }) => slug === 'pages')?.fields, 'body') as {
      editor: LexicalRichTextAdapter
    }
    const linkFields = (editor.editorConfig.resolvedFeatureMap.get('link')?.sanitizedServerFeatureProps as { fields: Field[] })
      .fields
    expect(linkFields.map((field) => 'name' in field && field.name)).toEqual(['text', 'linkType', 'url', 'doc', 'newTab'])
    // Lexical's own label, filter and condition stay, so an editor sees its picker.
    expect(fieldNamed(linkFields, 'doc')).toMatchObject({
      admin: { condition: expect.any(Function) },
      filterOptions: expect.any(Function),
      label: expect.any(Function),
      relationTo: ['pages', 'posts'],
      required: true
    })
  })

  it.each<[string, string[], string]>([
    [
      'a collection without a path',
      ['pages', 'media'],
      '@payloadpack/path was given collections without a path in the relationTo of the field doc: media, so give each one a path or take it out of relationTo.'
    ],
    [
      'no collection',
      [],
      '@payloadpack/path was given an empty relationTo for the field doc, so name a collection with a path in it or leave relationTo out.'
    ]
  ])('refuses a field given %s', async (_label, relationTo, refusal) => {
    const pages = collection('pages', [pathRelationshipField({ name: 'doc', relationTo })])

    await expect(configWith([pages, collection('media')], { collections: ['pages'] })).rejects.toThrow(refusal)
  })

  it("takes a relationship field's config without type, and keeps every other property", () => {
    const filterOptions: FilterOptions = { title: { exists: true } }
    const field = pathRelationshipField({
      admin: { allowCreate: false },
      custom: { site: 'own' },
      filterOptions,
      hasMany: true,
      label: 'Related',
      maxRows: 3,
      name: 'related'
    })

    expect(field).toEqual({
      admin: { allowCreate: false },
      custom: { pathRelationshipField: { setPathCollections: true }, site: 'own' },
      filterOptions,
      hasMany: true,
      label: 'Related',
      maxRows: 3,
      name: 'related',
      relationTo: [],
      type: 'relationship'
    })
    // A list it is given is the field's relationTo from the start, so it holds where the plugin can't reach.
    expect(pathRelationshipField({ name: 'doc', relationTo: ['pages'] })).toMatchObject({
      custom: { pathRelationshipField: { setPathCollections: false } },
      relationTo: ['pages']
    })
    // Named by the types payload generate:types writes, so a site's own types refuse a collection without a path.
    expectTypeOf<Parameters<typeof pathRelationshipField>[0]['relationTo']>().toEqualTypeOf<PathCollectionSlug[] | undefined>()
    // @ts-expect-error the type is always relationship
    pathRelationshipField({ name: 'doc', type: 'relationship' })
    // @ts-expect-error minRows only goes with hasMany, as on Payload's own relationship field
    pathRelationshipField({ minRows: 1, name: 'doc' })
  })
})
