---
title: findByPath
description: Find the document at a path, in any of the plugin's collections, in one indexed query per collection.
---

```ts
import { findByPath } from '@payloadpack/path'

const found = await findByPath({ path: '/about/team', payload })
```

| Argument      | What it is                                                                  | Default                  |
| ------------- | --------------------------------------------------------------------------- | ------------------------ |
| `payload`     | Your Payload instance                                                       |                          |
| `path`        | The path, starting with `/`, without a locale                               |                          |
| `locale`      | With localization, the locale the path is in                                | Payload's default locale |
| `draft`       | Find the latest draft at the path, for [previews](/path/drafts/#previews)   | `false`                  |
| `collections` | Which of the plugin's collections to look in                                | All of them              |
| `depth`       | How deep the document's relationships are populated, as in Payload's `find` | `0`                      |
| `paths`       | Also return the document's [path in each locale](#paths-in-each-locale)     | none                     |

## What it returns

```ts
{ collection: 'pages', document: { id: '…', title: 'Team', path: '/about/team', … } }
```

- `null` when nothing is published at the path.
- `found.collection` tells TypeScript which collection `found.document` is from. So a `switch` on it picks the template with the right type. With `collections: ['pages']`, the result is a page or `null`.
- It reads as the server and ignores access control. Use it for content your site shows anyway.

```tsx
if (!found) notFound()
switch (found.collection) {
  case 'pages':
    return <PageTemplate page={found.document} />
  case 'posts':
    return <PostTemplate post={found.document} />
}
```

## The path you ask for

```ts
await findByPath({ path: '/about/team', payload }) // Team
await findByPath({ path: '/about/team/', payload }) // null
await findByPath({ path: '/', payload }) // the home page
```

It looks for the path exactly as stored. Remove a trailing slash before you call it, but keep `/` for the home page.

<details>
<summary>Good to know</summary>

- It runs one indexed query per collection it searches, all at once, and none for a path with a [reserved slug](/path/configuration/#reserved-slugs).
- It never returns a document in the trash.
- In a collection with [one path in every locale](/path/languages/#one-path-in-every-locale), a document is found at its path in each locale it is published in.
- If `collections` names a collection the plugin wasn't given, it throws:

  > @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.

</details>

## Paths in each locale

```ts
const found = await findByPath({ locale: 'en', path: '/about', paths: true, payload })
// { collection: 'pages', document: { … }, paths: [{ locale: 'en', path: '/about' }, { locale: 'sv', path: '/om-oss' }] }
```

With `paths: true`, your route also gets the page's paths in your other languages, the same ones [`findPaths`](/path/api/find-paths/) returns.

<details>
<summary>Good to know</summary>

- With `paths`, it reads the document once more after it finds it. Without `paths`, it reads nothing more, and the result has no `paths`.
- With `draft: true` in a collection with drafts, it also reads the document's latest version and returns the paths that draft would give it.

</details>
