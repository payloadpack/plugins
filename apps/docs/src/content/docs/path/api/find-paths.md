---
title: findPaths
description: Find the paths of one document in each locale, so your site can link to it in the others.
---

```ts
import { findByPath, findPaths } from '@payloadpack/path'

const found = await findByPath({ locale: 'en', path: '/about', payload })
if (found) {
  const paths = await findPaths({ collection: found.collection, id: found.document.id, payload })
  // [{ locale: 'en', path: '/about' }, { locale: 'sv', path: '/om-oss' }]
}
```

It returns the document's path in each locale it is published in, in the order of your locales. Put each locale where your site keeps it, in a prefix, a domain or a cookie, and you have the links to the page in the other languages, such as the alternate links in its head.

A route that already calls `findByPath` can ask it for the same paths with [`paths: true`](/path/api/find-by-path/#paths-in-each-locale), instead of a second call.

| Argument     | What it is                                                                 | Default |
| ------------ | -------------------------------------------------------------------------- | ------- |
| `payload`    | Your Payload instance                                                      |         |
| `collection` | The collection the document is in, among the plugin's                      |         |
| `id`         | The document's id                                                          |         |
| `draft`      | Give the paths of the latest draft, for [previews](/path/drafts/#previews) | `false` |

- Without localization it returns one path without a `locale`, such as `[{ path: '/about' }]`, or `[]` when the document isn't published.
- A locale the document isn't published in is left out, and so is a locale without a path. In a collection with `localized: true` and without drafts, a locale has a path once the document is saved in it.
- A document of a collection with [one path in every locale](/path/languages/#one-path-in-every-locale) has its one path listed once for each locale it is published in, as `onPathsChanged` lists it.
- With `draft: true` it returns the paths the latest draft would give the document, in every locale that has one, so a preview links to a new slug before it is published, and a document that was never published has paths too. In a collection without drafts it returns the same as without it.
- It reads as the server, so it ignores access control. Use it for what your site shows anyway.
- A document in the trash and an id that doesn't exist both give `[]`.
- A collection the plugin wasn't given stops it with:

> @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.
