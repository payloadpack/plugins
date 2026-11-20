---
title: onPathsChanged
description: Hear where your site finds each document after a publish, a move or a delete, so it can purge its cache and keep its redirects.
---

```ts title="payload.config.ts"
import { revalidatePath } from 'next/cache'

pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: ({ changedPaths }) => {
    for (const { from, to } of changedPaths) {
      if (from) revalidatePath(from)
      if (to) revalidatePath(to)
    }
  }
})
```

## What it is given

```ts
type PathsChangedArgs = {
  changedPaths: ChangedPath[]
  payload: Payload
  req: PayloadRequest
}

type ChangedPath = {
  collection: string
  id: number | string
  locale?: string
  from: string | null
  to: string | null
}
```

| After                                     | `from`       | `to`          |
| ----------------------------------------- | ------------ | ------------- |
| A publish                                 | `null`       | The path      |
| A publish that keeps the path             | The path     | The same path |
| An unpublish, a delete, or into the trash | The path     | `null`        |
| Out of the trash, as published            | `null`       | The path      |
| A move                                    | The old path | The new path  |
| A move or a delete of a document above it | The old path | The new path  |

- Each entry is one published document in one locale, where your site found it before and finds it now. The saved or deleted document comes first, then each document below it, top-down.
- Only what your site shows is listed. A draft save of a published document lists nothing, and neither does a document that isn't published. When a document that isn't published moves, the published documents below it are still listed.
- Each entry names the collection as well as the id, since a page and a post may share an id on Postgres and SQLite.

<details>
<summary>Good to know</summary>

- It isn't called when there is nothing to list. A delete of a document in the trash lists no path of its own, since your site heard it when it went there, and still lists the documents below that were lifted.
- A move of a big branch lists every published document below it, so a branch of thousands gives thousands of entries.
- With localization, each entry has its `locale`, and only the locales the save changed are listed, which usually includes the ones that fall back to a renamed slug.
- A collection with [one path in every locale](/path/languages/#one-path-in-every-locale) is listed in the same shape: its one path once for each locale your site finds the document in.
- A bulk delete that deletes a document and one below it reports each delete on its own, and they may come in either order. Each lifted document is listed with where it ended up. A document that was lifted and then deleted in the same bulk delete is listed by both: with a `to` by the delete above it, and without one by its own.

</details>

## What is yours to purge

```ts
for (const { locale, from, to } of changedPaths) {
  for (const path of [from, to]) {
    if (path) revalidatePath(`/${locale}${path === '/' ? '' : path}`)
  }
}
```

- **The locale in your URLs.** A path never holds the locale, so with a prefix such as `/sv` you put it in front yourself, as above.
- **Pages that show another document**, such as a menu, a page that lists the documents below it, breadcrumbs or a sitemap. They aren't listed, so purge them by a tag, or all of them with `revalidatePath('/', 'layout')`.
- **A run of `backfillPaths`.** It doesn't call `onPathsChanged`, so purge everything once after a run that updated documents.

## Redirects

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: async ({ changedPaths, payload, req }) => {
    for (const { from, to, locale } of changedPaths) {
      if (!from || !to || from === to) continue
      // redirects is a collection of yours. With req, the redirect is undone when the save fails.
      await payload.create({ collection: 'redirects', data: { from, to, locale }, overrideAccess: true, req })
    }
  }
})
```

A document that moves back to where it was leaves two redirects that point at each other. Before you save one, remove the redirects whose `from` is its `to`.

## When it runs

```ts
// A seed script or a job runs outside a request of Next, where revalidatePath throws and fails the save.
await payload.create({ collection: 'pages', context: { seeding: true }, data: { title: 'About' } })
```

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: ({ changedPaths, req }) => {
    if (req.context.seeding) return
    for (const { from, to } of changedPaths) {
      if (from) revalidatePath(from)
      if (to) revalidatePath(to)
    }
  }
})
```

- It runs after the plugin's own work, inside the request of the save or the delete, and the save waits for it, async too.
- A throw fails the save, so catch what shouldn't stop an editor from publishing, or skip it on a flag of your own in `req.context`, as above.
- With transactions it runs before the save is committed. Pass `req` to what you write, as the redirects above do, so it is undone with a save that fails.

<details>
<summary>Good to know</summary>

A page a visitor asks for between your purge and the commit is cached as it was. That holds for any hook of Payload that purges, and the next publish of the page puts it right.

</details>
