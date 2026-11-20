---
title: findPaths
description: Get a document's path in every locale so your site can link to its other languages.
---

```ts
import { findPaths } from '@payloadpack/path'

const paths = await findPaths({ collection: 'pages', id: page.id, payload })
// [{ locale: 'en', path: '/about' }, { locale: 'sv', path: '/om-oss' }]
```

| Argument     | Purpose                                                                | Default        |
| ------------ | ---------------------------------------------------------------------- | -------------- |
| `payload`    | Your Payload instance                                                  | Required       |
| `collection` | Collection slug (must be configured in `pathPlugin`)                   | Required       |
| `id`         | Document ID                                                            | Required       |
| `draft`      | Return the latest draft's paths for [previews](/path/drafts/#previews) | `false`        |
| `req`        | Request whose transaction the read should join                         | No transaction |

## What it returns

```ts
type FoundPath = { locale?: string; path: string }
```

- One entry per locale the document is published in, in your Payload locale order. Without localization, returns a single entry without `locale`: `[{ path: '/about' }]`.
- Returns `[]` if the document isn't published, is in the trash, or doesn't exist. Locales without a path are omitted.
- Reads as the server and ignores access control — use it for content your site displays publicly.

## Links to the other languages

```ts
const links = paths.map(({ locale, path }) => ({
  href: `/${locale}${path === '/' ? '' : path}`,
  hrefLang: locale
}))
```

Stored paths never include the locale — add your prefix, domain, or cookie yourself.

:::tip
Already calling `findByPath` in your route? Pass [`paths: true`](/path/api/find-by-path/#paths-in-each-locale) to get the same list without a second call.
:::

<details>
<summary>More details</summary>

- With `draft: true`, returns the paths the latest draft would give in every locale that has one (including never-published documents). Has no effect on collections without drafts.
- In a `localized: true` collection without drafts, a locale has a path once the document is saved in that locale.
- In a collection with [one path in every locale](/path/languages/#one-path-in-every-locale), the document's single path is listed once per published locale (same as `onPathsChanged`).
- Passing a collection not given to `pathPlugin()` throws:

  > @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.

</details>
