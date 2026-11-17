import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { commitTransaction, createPayloadRequest, initTransaction, type CollectionConfig, type Payload } from 'payload'
import { expect, it } from 'vitest'

import { ancestorsField } from '../src/fields/ancestors.js'
import { describeEachSetup } from './support/boot-payload.js'
import type { Setup } from './support/setups.js'

// What the plugin builds on in Payload's database API, proven on each database so a change in
// Payload fails here first. The collections hold the plugin's fields and none of its hooks.

type Row = { [key: string]: unknown; id: number | string }

// A collection with a field of every kind a site's own collection may hold beside the path.
const rich = (localized: boolean): CollectionConfig => ({
  slug: 'rich',
  fields: [
    { name: 'title', type: 'text', localized },
    {
      name: 'summary',
      type: 'group',
      fields: [
        { name: 'heading', type: 'text', localized },
        { name: 'note', type: 'text' }
      ]
    },
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', localized },
        { name: 'amount', type: 'number' }
      ]
    },
    {
      name: 'layout',
      type: 'blocks',
      blocks: [
        {
          slug: 'quote',
          fields: [
            { name: 'text', type: 'text', localized },
            { name: 'by', type: 'text' }
          ]
        },
        { slug: 'link', fields: [{ name: 'to', type: 'text' }] }
      ]
    },
    { name: 'related', type: 'relationship', relationTo: 'rich' },
    { name: 'manyRelated', type: 'relationship', hasMany: true, relationTo: 'rich' },
    { name: 'tags', type: 'text', hasMany: true },
    { name: 'colors', type: 'select', hasMany: true, options: ['red', 'green', 'blue'] },
    { name: 'count', type: 'number' },
    { name: 'publishedOn', type: 'date' },
    { name: 'featured', type: 'checkbox' },
    { name: 'meta', type: 'json' },
    { name: 'body', type: 'richText', editor: lexicalEditor() },
    { name: 'path', type: 'text', index: true, localized },
    ancestorsField('rich')
  ],
  versions: { drafts: true }
})

// What a statement could take for its own: both quotes and an escape.
const HOSTILE = `it's "x" \\`

// A collection whose documents take the ids they are given.
const tagged: CollectionConfig = {
  slug: 'tagged',
  fields: [{ name: 'id', type: 'text' }, ancestorsField('tagged')]
}

const richText = (text: string) => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 }],
        direction: 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        version: 1
      }
    ],
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1
  }
})

const plain = (payload: Payload, title: string) =>
  payload.create({ collection: 'rich', data: { _status: 'published', title }, overrideAccess: true }) as Promise<Row>

// A published document with a value in every field, in each locale, and a newer draft on top.
async function createRichDocument(payload: Payload, { localized }: Setup) {
  const [first, second] = [await plain(payload, 'First'), await plain(payload, 'Second')]
  const document = (await payload.create({
    collection: 'rich',
    data: {
      _status: 'published',
      body: richText('The body'),
      colors: ['red', 'blue'],
      count: 7,
      featured: true,
      items: [
        { amount: 1, label: 'One' },
        { amount: 2, label: 'Two' }
      ],
      layout: [
        { blockType: 'quote', by: 'Someone', text: 'A quote' },
        { blockType: 'link', to: '/somewhere' }
      ],
      manyRelated: [second.id, first.id],
      meta: { nested: { list: [1, 'two', null] } },
      path: '/rich',
      publishedOn: '2026-01-02T03:04:05.000Z',
      related: first.id,
      summary: { heading: 'A heading', note: 'A note' },
      tags: ['one', 'two'],
      title: 'Rich'
    },
    locale: localized ? 'en' : undefined,
    overrideAccess: true
  })) as Row & { items: Row[]; layout: Row[] }
  if (localized) {
    await payload.update({
      collection: 'rich',
      data: {
        _status: 'published',
        items: document.items.map((item, index) => ({ ...item, label: ['Ett', 'Två'][index] })),
        layout: document.layout.map((block) => (block.blockType === 'quote' ? { ...block, text: 'Ett citat' } : block)),
        path: '/rik',
        summary: { heading: 'En rubrik' },
        title: 'Rik'
      },
      id: document.id,
      locale: 'sv',
      overrideAccess: true
    })
  }
  await payload.update({
    collection: 'rich',
    data: { count: 8, tags: ['three'], title: 'Rich draft' },
    draft: true,
    id: document.id,
    locale: localized ? 'en' : undefined,
    overrideAccess: true
  })
  return { document, first, second }
}

const readRow = (payload: Payload, id: Row['id']) =>
  payload.db.findOne<Row>({ collection: 'rich', joins: false, where: { id: { equals: id } } })

// A document's latest version, found as Payload itself finds it.
async function readLatestVersionRow(payload: Payload, id: Row['id']) {
  const { docs } = await payload.db.findVersions<Row>({
    collection: 'rich',
    limit: 1,
    pagination: false,
    sort: '-updatedAt',
    where: { and: [{ parent: { equals: id } }, { latest: { equals: true } }] }
  })
  return docs[0]!
}

const readThroughPayload = (payload: Payload, id: Row['id'], draft: boolean) =>
  payload.findByID({ collection: 'rich', depth: 0, draft, id, locale: 'all', overrideAccess: true })

describeEachSetup(
  "on Payload's database API",
  { boot: (setup) => ({ collections: [rich(setup.localized), tagged], plugin: false }) },
  (test, setup) => {
    const inLocales = (english: string, swedish: string) => (setup.localized ? { en: english, sv: swedish } : english)

    it('writes back the document it read with another path and ancestors, and leaves every other value as it was', async () => {
      const { payload } = test
      const { document, first, second } = await createRichDocument(payload, setup)
      const before = (await readRow(payload, document.id))!
      const [publishedBefore, draftBefore] = [
        await readThroughPayload(payload, document.id, false),
        await readThroughPayload(payload, document.id, true)
      ]
      const moved = { ancestors: [second.id, first.id], path: inLocales('/moved', '/flyttad') }

      const req = await createPayloadRequest({ payload })
      await initTransaction(req)
      await payload.db.updateOne({
        collection: 'rich',
        data: { ...structuredClone(before), ...moved },
        id: document.id,
        req,
        returning: false
      })
      await commitTransaction(req)

      expect(before.title).toEqual(inLocales('Rich', 'Rik'))
      expect(await readRow(payload, document.id)).toEqual({ ...before, ...moved })
      expect(await readThroughPayload(payload, document.id, false)).toEqual({ ...publishedBefore, ...moved })
      expect(await readThroughPayload(payload, document.id, true)).toEqual(draftBefore)
    })

    it('writes back the latest version it read with another path and ancestors, and leaves every other value as it was', async () => {
      const { payload } = test
      const { document, first, second } = await createRichDocument(payload, setup)
      const before = await readLatestVersionRow(payload, document.id)
      const [publishedBefore, draftBefore] = [
        await readThroughPayload(payload, document.id, false),
        await readThroughPayload(payload, document.id, true)
      ]
      const moved = { ancestors: [second.id, first.id], path: inLocales('/moved', '/flyttad') }
      const version = before.version as Row

      const req = await createPayloadRequest({ payload })
      await initTransaction(req)
      await payload.db.updateVersion({
        collection: 'rich',
        id: before.id,
        req,
        returning: false,
        versionData: { ...structuredClone(before), version: { ...structuredClone(version), ...moved } } as never
      })
      await commitTransaction(req)

      expect(version.title).toEqual(inLocales('Rich draft', 'Rik'))
      expect(await readLatestVersionRow(payload, document.id)).toEqual({ ...before, version: { ...version, ...moved } })
      expect(await readThroughPayload(payload, document.id, true)).toEqual({ ...draftBefore, ...moved })
      expect(await readThroughPayload(payload, document.id, false)).toEqual(publishedBefore)
    })

    it('keeps the ancestors as ids in the order given, and finds and counts every document below a document by them', async () => {
      const { payload } = test
      // Created bottom-up, so the order top-down is another than the order of the ids.
      const [leaf, middle, top, aside] = [
        await plain(payload, 'Leaf'),
        await plain(payload, 'Middle'),
        await plain(payload, 'Top'),
        await plain(payload, 'Aside')
      ]
      const save = (id: Row['id'], ancestors: Row['id'][]) =>
        payload.update({ collection: 'rich', data: { _status: 'published', ancestors }, id, overrideAccess: true })
      await save(middle.id, [top.id])
      await save(leaf.id, [top.id, middle.id])
      const below = async (id: Row['id'], operator: 'equals' | 'in') => {
        const where = { ancestors: { [operator]: operator === 'in' ? [id] : id } }
        const { docs } = await payload.db.find<Row>({ collection: 'rich', pagination: false, where })
        const { totalDocs } = await payload.db.count({ collection: 'rich', where })
        expect(totalDocs).toBe(docs.length)
        return docs.map((found) => found.id).sort()
      }

      expect((await readRow(payload, leaf.id))!.ancestors).toEqual([top.id, middle.id])
      expect(await below(top.id, 'equals')).toEqual([leaf.id, middle.id].sort())
      expect(await below(top.id, 'in')).toEqual([leaf.id, middle.id].sort())
      expect(await below(middle.id, 'equals')).toEqual([leaf.id])
      expect(await below(leaf.id, 'equals')).toEqual([])
      expect(await below(aside.id, 'equals')).toEqual([])

      const { docs: versionsBelow } = await payload.db.findVersions<Row>({
        collection: 'rich',
        pagination: false,
        where: { and: [{ 'version.ancestors': { equals: top.id } }, { latest: { equals: true } }] }
      })
      expect(versionsBelow.map((version) => version.parent).sort()).toEqual([leaf.id, middle.id].sort())
      expect((await readLatestVersionRow(payload, leaf.id)).version).toMatchObject({ ancestors: [top.id, middle.id] })

      for (const depth of [0, 1, 2]) {
        const read = await payload.findByID({
          collection: 'rich',
          depth,
          id: leaf.id,
          overrideAccess: true
        })
        expect((read as Row).ancestors).toEqual([top.id, middle.id])
      }
    })

    it('finds the documents below a document whose id holds a quote and a backslash', async () => {
      const { payload } = test
      const idOf = (name: string) => `${name} ${HOSTILE}`
      const create = (name: string, ancestors: string[]) =>
        payload.create({ collection: 'tagged', data: { id: idOf(name), ancestors }, overrideAccess: true })
      await create('shelf', [])
      await create('box', [idOf('shelf')])
      await create('jar', [idOf('shelf'), idOf('box')])
      await create('crate', [])
      const where = { ancestors: { equals: idOf('shelf') } }

      const { docs } = await payload.db.find<Row>({ collection: 'tagged', pagination: false, where })

      expect(docs.map(({ id }) => id).sort()).toEqual([idOf('box'), idOf('jar')])
      expect(await payload.db.count({ collection: 'tagged', where })).toEqual({ totalDocs: 2 })
      expect(docs.find(({ id }) => id === idOf('jar'))!.ancestors).toEqual([idOf('shelf'), idOf('box')])
    })
  }
)
