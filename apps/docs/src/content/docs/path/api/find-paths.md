---
title: findPaths
description: Find the paths of one document in each locale, so your site can link to it in the others.
---

```ts
import { findPaths } from '@payloadpack/path'

const paths = await findPaths({ collection: 'pages', id: page.id, payload })
// [{ locale: 'en', path: '/about' }, { locale: 'sv', path: '/om-oss' }]
```

| Argument     | What it is                                                                 | Default |
| ------------ | -------------------------------------------------------------------------- | ------- |
| `payload`    | Your Payload instance                                                      |         |
| `collection` | The collection the document is in, among the plugin's                      |         |
| `id`         | The document's id                                                          |         |
| `draft`      | Give the paths of the latest draft, for [previews](/path/drafts/#previews) | `false` |

## What it returns

```ts
type FoundPath = { locale?: string; path: string }
```

- The document's path in each locale it is published in, in the order of your locales, and without localization one path without a `locale`, such as `[{ path: '/about' }]`.
- `[]` for a document that isn't published, a document in the trash and an id that doesn't exist. A locale without a path is left out.
- It reads as the server, so it ignores access control. Use it for what your site shows anyway.

## Links to the other languages

```ts
const links = paths.map(({ locale, path }) => ({ href: `/${locale}${path === '/' ? '' : path}`, hrefLang: locale }))
```

A path never holds the locale, so put it where your site keeps it, in a prefix, a domain or a cookie. Here it is a prefix, for the alternate links in the page's head.

:::tip
A route that already calls `findByPath` gets the same paths with [`paths: true`](/path/api/find-by-path/#paths-in-each-locale), without a second call.
:::

<details>
<summary>Good to know</summary>

- With `draft: true` it returns the paths the latest draft would give the document, in every locale that has one, so a preview links to a new slug before it is published, and a document that was never published has paths too. In a collection without drafts it returns the same as without it.
- In a collection with `localized: true` and without drafts, a locale has a path once the document is saved in it.
- A document of a collection with [one path in every locale](/path/languages/#one-path-in-every-locale) has its one path listed once for each locale it is published in, as `onPathsChanged` lists it.
- A collection the plugin wasn't given stops it with:

  > @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.

</details>
