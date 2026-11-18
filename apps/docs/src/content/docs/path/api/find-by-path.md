---
title: findByPath
description: Find the document at a path, in any of the plugin's collections, in one indexed query per collection.
---

```ts
import { findByPath } from '@payloadpack/path'

const found = await findByPath({ path: '/about/team', payload })
```

It returns the document and the collection it is in, or `null` when nothing is published at the path:

```ts
{ collection: 'pages', document: { id: '…', title: 'Team', path: '/about/team', … } }
```

`found.collection` tells TypeScript which collection `found.document` belongs to, so a `switch` on it picks the right template with the right type.

| Argument      | What it is                                                                  | Default                  |
| ------------- | --------------------------------------------------------------------------- | ------------------------ |
| `payload`     | Your Payload instance                                                       |                          |
| `path`        | The path, starting with `/`, without a locale                               |                          |
| `locale`      | With localization, the locale the path is in                                | Payload's default locale |
| `draft`       | Find the latest draft at the path, for [previews](/path/drafts/#previews)   | `false`                  |
| `collections` | The collections to look in, among the plugin's                              | All of them              |
| `depth`       | How deep the document's relationships are populated, as in Payload's `find` | `0`                      |

- It runs one indexed query per collection it looks in, at the same time, and none for a path with a [reserved slug](/path/configuration/#reserved-slugs).
- It reads as the server, so it ignores access control. Use it for what your site shows anyway.
- It asks for the path as it is stored, so `/about/team/` finds nothing. Take a last slash off before you ask, and keep `/` for the home page.
- It never returns a document in the trash.
- A document of a collection given with [`localized: false`](/path/languages/#one-path-in-every-locale) is found at its one path under each locale it is published in.
- `collections` narrows the type too, so with `collections: ['pages']` the result is a page or `null`. A collection the plugin wasn't given stops it with:

> @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.
