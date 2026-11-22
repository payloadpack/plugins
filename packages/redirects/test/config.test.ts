import { buildConfig, type CollectionConfig, type Field, type Plugin } from 'payload'
import { describe, expect, it } from 'vitest'

import { redirectsPlugin, type BuildDocumentPath } from '../src/index.js'
import { EMPTY_COLLECTIONS_ERROR, WIN_OVER_DOCUMENTS_ERROR } from '../src/plugin/messages.js'

const buildCollection = (slug: string): CollectionConfig => ({ slug, fields: [{ name: 'title', type: 'text' }] })

// The config tests look up no redirect, so no path is ever built.
const buildDocumentPath: BuildDocumentPath = () => null

type Config = Parameters<typeof buildConfig>[0]

const buildConfigWith = (plugins: Plugin[]) =>
  buildConfig({ collections: [buildCollection('pages'), buildCollection('news')], plugins, secret: 'redirects-tests' } as Config)

describe('redirectsPlugin', () => {
  it("adds the box that lets a redirect win over a document only with winOverDocuments 'perRedirect'", async () => {
    const findWinsOverDocumentField = async (winOverDocuments?: 'always' | 'perRedirect') =>
      (await buildConfigWith([redirectsPlugin({ buildDocumentPath, collections: ['pages'], winOverDocuments })])).collections
        .find(({ slug }) => slug === 'redirects')
        ?.fields.find(
          (field): field is Extract<Field, { type: 'checkbox' }> => field.type === 'checkbox' && field.name === 'winsOverDocument'
        )

    expect(await findWinsOverDocumentField()).toBeUndefined()
    expect(await findWinsOverDocumentField('always')).toBeUndefined()
    expect(await findWinsOverDocumentField('perRedirect')).toMatchObject({ label: 'Wins over a page' })
  })

  it('refuses a winOverDocuments it does not know', async () => {
    await expect(
      buildConfigWith([redirectsPlugin({ buildDocumentPath, collections: ['pages'], winOverDocuments: 'sometimes' as never })])
    ).rejects.toThrow(WIN_OVER_DOCUMENTS_ERROR)
  })

  it('loads the notices of suggestions from the collection overrides renamed, and answers them there', async () => {
    const config = await buildConfigWith([
      redirectsPlugin({
        buildDocumentPath,
        collections: ['pages'],
        overrides: (redirects) => ({ ...redirects, slug: 'old-links' })
      })
    ])
    const notices = config.collections
      .find(({ slug }) => slug === 'pages')
      ?.fields.find((field) => 'name' in field && field.name === 'redirectSuggestions')

    expect(notices?.admin?.components).toMatchObject({
      Field: { clientProps: { redirectsSlug: 'old-links', suggestionsPath: '/old-links/suggestions' } }
    })
  })

  it('refuses collections that name none', async () => {
    await expect(buildConfigWith([redirectsPlugin({ buildDocumentPath, collections: [] })])).rejects.toThrow(
      EMPTY_COLLECTIONS_ERROR
    )
  })
})
