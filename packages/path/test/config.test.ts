import { buildConfig, type CollectionConfig } from 'payload'
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

  it('gives a collection given with localized: false one slug and one path, and the others one per locale', async () => {
    const config = await configWith(
      [collection('pages'), collection('products')],
      { collections: ['pages', { localized: false, slug: 'products' }] },
      { defaultLocale: 'en', locales: ['en', 'sv'] }
    )

    const localizedOf = (slug: string) =>
      ['slug', 'path'].map((name) =>
        fieldsOf(config, slug).some((field) => field.name === name && 'localized' in field && field.localized)
      )
    expect(localizedOf('pages')).toEqual([true, true])
    expect(localizedOf('products')).toEqual([false, false])
  })

  it('takes false alone as localized of a collection', () => {
    expectTypeOf<Exclude<PathCollection, string>>().toHaveProperty('localized').toEqualTypeOf<false | undefined>()
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
