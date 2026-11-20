---
title: findPaths
description: Find the paths of one document in each locale, so your site can link to it in the others.
---

```ts
import { findPaths } from '@payloadpack/path'

const paths = await findPaths({ collection: 'pages', id: page.id, payload })
// [{ locale: 'en', path: '/about' }, { locale: 'sv', path: '/om-oss' }]
```

| Argument     | What it is                                                                   | Default |
| ------------ | ---------------------------------------------------------------------------- | ------- |
| `payload`    | Your Payload instance                                                        |         |
| `collection` | The document's collection, one of the plugin's                               |         |
| `id`         | The document's id                                                            |         |
| `draft`      | Return the paths of the latest draft, for [previews](/path/drafts/#previews) | `false` |

## What it returns

```ts
type FoundPath = { locale?: string; path: string }
```

- The document's path in each locale it is published in, in the order of your locales. Without localization, one path without a `locale`, such as `[{ path: '/about' }]`.
- `[]` for a document that isn't published, a document in the trash, or an id that doesn't exist. A locale without a path is left out.
- It reads as the server and ignores access control. Use it for content your site shows anyway.

## Links to the other languages

```ts
const links = paths.map(({ locale, path }) => ({ href: `/${locale}${path === '/' ? '' : path}`, hrefLang: locale }))
```

A path never includes the locale. Add it where your site keeps it: in a prefix, a domain or a cookie. Here it is a prefix, for the alternate links in the page's head.

:::tip
If your route already calls `findByPath`, pass [`paths: true`](/path/api/find-by-path/#paths-in-each-locale) to get the same paths without a second call.
:::

<details>
<summary>Good to know</summary>

- With `draft: true`, it returns the paths the latest draft would give the document, in every locale that has one. So a preview links to a new slug before it is published, and a document that was never published has paths too. In a collection without drafts, `draft: true` changes nothing.
- In a collection with `localized: true` and without drafts, a locale has a path once the document is saved in it.
- In a collection with [one path in every locale](/path/languages/#one-path-in-every-locale), a document's one path is listed once for each locale it is published in, as in `onPathsChanged`.
- If `collection` is one the plugin wasn't given, it throws:

  > @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.

</details>
