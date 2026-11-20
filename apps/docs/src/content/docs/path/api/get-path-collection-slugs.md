---
title: getPathCollectionSlugs
description: List the collections that get a path, for a link field, live preview or a sitemap that needs them.
---

```ts title="payload.config.ts"
import { getPathCollectionSlugs, pathPlugin } from '@payloadpack/path'
import type { Plugin } from 'payload'

// A plugin after pathPlugin() sees the collections it was given.
const livePreview: Plugin = (config) => ({
  ...config,
  admin: {
    ...config.admin,
    livePreview: {
      collections: getPathCollectionSlugs(config),
      url: ({ collectionConfig, data }) => `/preview/${collectionConfig?.slug}/${data.id}`
    }
  }
})

export default buildConfig({
  collections: [pages, posts],
  plugins: [pathPlugin({ collections: ['pages', 'posts'] }), livePreview]
})
```

| Argument | Purpose                                                                                                                                 | Default  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `config` | A Payload config `pathPlugin()` has run on: the one a plugin after it gets, the one a field's config function gets, or `payload.config` | Required |

## What it returns

The slugs of every collection that gets a path, as `PathCollectionSlug[]`: the ones listed in `collections` first, then the ones wrapped in [`withPath`](/path/configuration/#in-the-collections-own-config), in the order of your config.

## Where it works

- In a plugin placed after `pathPlugin()`, from the config the plugin gets.
- In a field's config function, such as the `fields` of Lexical's `LinkFeature`, so a link picks only documents with a path:

  ```ts
  LinkFeature({
    fields: ({ config }) => [{ name: 'doc', type: 'relationship', relationTo: getPathCollectionSlugs(config), required: true }]
  })
  ```

- At runtime, from `payload.config`, for example to query each collection for a sitemap.

<details>
<summary>More details</summary>

- It reads what `pathPlugin()` keeps in the config, so it makes no query.
- `withPath` keeps a collection's options in the collection's `custom` under `WITH_PATH_KEY`, which is `'withPath'`.
- In a config `pathPlugin()` hasn't run on, or one where it was given no collection, it throws:

  > @payloadpack/path: add pathPlugin() to the Payload config, with a collection in collections or wrapped in withPath, before calling findByPath, findPaths, backfillPaths or getPathCollectionSlugs

</details>
