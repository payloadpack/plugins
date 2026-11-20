---
title: findByPath
description: Find the document at a path across your configured collections in one indexed query per collection.
---

```ts
import { findByPath } from '@payloadpack/path'

const found = await findByPath({ path: '/about/team', payload })
// {
//   collection: 'pages',
//   document: { id: '…', title: 'Team', path: '/about/team', … }
// }
```

| Argument         | Purpose                                                                               | Default                    |
| ---------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| `payload`        | Your Payload instance                                                                 | Required                   |
| `path`           | Stored path starting with `/`, without a locale                                       | Required                   |
| `collections`    | Subset of configured collections to search                                            | All configured collections |
| `paths`          | Set `true` to also return [paths in each locale](#paths-in-each-locale)               | Omitted                    |
| `locale`         | Locale to look up (when localization is enabled)                                      | Payload's default locale   |
| `draft`          | Match the latest draft instead of published docs ([previews](/path/drafts/#previews)) | `false`                    |
| `depth`          | Relationship population depth, as in `payload.find`                                   | `0`                        |
| `overrideAccess` | Bypass access control, as in `payload.find`                                           | `true`                     |
| `disableErrors`  | Set `false` to throw Payload's `Forbidden` for a collection the reader may not read   | `true`                     |

## Payload find options

`findByPath` also takes these options of `payload.find`, as Payload types them: `select`, `populate`, `where`, `user`, `req`, `context`, `fallbackLocale`, `joins`, `showHiddenFields` and `includeLockStatus`.

```ts
const found = await findByPath({
  collections: ['pages'],
  path: '/members/dashboard',
  overrideAccess: false,
  user,
  select: { title: true, layout: true },
  populate: { media: { url: true, alt: true } },
  depth: 1,
  payload
})
```

- **`select`:** Include or exclude fields as in `payload.find`. You still only get published documents, whatever your `select` leaves out.
- **`where`:** Added to the path and published checks, never in their place. Every collection you search needs the fields your `where` names.
- **`req`:** The lookup, and `paths: true`, read inside your request's transaction.
- **Left out:** `collection` (use `collections`), `limit`, `page`, `pagination`, `sort` and `trash`, since a document in the trash has no path. An option Payload adds later reaches `findByPath` once a release of this package takes it.

## What it returns

```tsx
if (!found) notFound()

switch (found.collection) {
  case 'pages':
    return <PageTemplate page={found.document} />
  case 'posts':
    return <PostTemplate post={found.document} />
}
```

- Returns `{ collection, document }`, or `null` when nothing is published at that path.
- `found.collection` narrows `found.document`'s TypeScript type. Without `collections`, it is one of the collections you gave `pathPlugin()`, once you have run `payload generate:types` with the plugin in your config. Before that, it can be any collection. Passing `collections: ['pages']` narrows it to a page or `null`, and `select` narrows `found.document` as in `payload.find`.
- Reads as the server by default (`overrideAccess: true`). Pass `overrideAccess: false` with `user` or `req` to apply your access control, and a collection the reader may not read then has nothing at the path.

## The path you ask for

```ts
await findByPath({ path: '/about/team', payload }) // Team
await findByPath({ path: '/about/team/', payload }) // null (trailing slash)
await findByPath({ path: '/', payload }) // Home page
```

Matches the stored path verbatim. Strip trailing slashes before calling, except `/` for the home page.

<details>
<summary>More details</summary>

- Runs 1 indexed query per searched collection in parallel (or sequentially inside a transaction), and 0 queries for a path with a [reserved slug](/path/configuration/#reserved-slugs).
- Never returns a document in the trash.
- In a collection with [one path in every locale](/path/languages/#one-path-in-every-locale), a document is found at its path in each locale it is published in.
- Passing a collection not given to `pathPlugin()` throws:

  > @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.

</details>

## Paths in each locale

```ts
const found = await findByPath({
  locale: 'en',
  path: '/about',
  paths: true,
  payload
})
// {
//   collection: 'pages',
//   document: { … },
//   paths: [{ locale: 'en', path: '/about' }, { locale: 'sv', path: '/om-oss' }]
// }
```

Passing `paths: true` includes the document's paths in all published locales — the same list [`findPaths`](/path/api/find-paths/) returns.

<details>
<summary>More details</summary>

- `paths: true` performs 1 extra read of the matched document (omitting `paths` performs no extra read and omits `paths` from the result).
- With `draft: true` on a drafts-enabled collection, it also reads the latest version and returns that draft's paths.

</details>
