---
title: onPathsChanged
description: Get each document's old and new path after a publish, a move or a delete, so your site can purge its cache and keep its redirects.
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

- Each entry is one published document in one locale, with its old and new path. The saved or deleted document comes first, then each document below it, top-down.
- Only published documents are listed. A draft save of a published document lists nothing, and neither does a document that isn't published. When a document that isn't published moves, the published documents below it are still listed.
- Each entry has the collection as well as the id, because a page and a post may have the same id on Postgres and SQLite.

<details>
<summary>Good to know</summary>

- It isn't called when there is nothing to list. Deleting a document from the trash lists no path for it, since your site already heard about it when it went into the trash. The lifted documents below it are still listed.
- A move of a big branch lists every published document below it. A branch of thousands means thousands of entries.
- With localization, each entry has its `locale`. Only the locales the save changed are listed. These usually include the locales that fall back to a renamed slug.
- A collection with [one path in every locale](/path/languages/#one-path-in-every-locale) is listed the same way: its one path once for each locale the document is published in.
- A bulk delete of a document and one below it reports each delete on its own, in either order. Each lifted document is listed with its new path. A document that was lifted and then deleted in the same bulk delete is listed in both: with a `to` in the report of the delete above it, and without one in its own.

</details>

## What is yours to purge

```ts
for (const { locale, from, to } of changedPaths) {
  for (const path of [from, to]) {
    if (path) revalidatePath(`/${locale}${path === '/' ? '' : path}`)
  }
}
```

- **The locale in your URLs.** A path never includes the locale. If you use a prefix such as `/sv`, add it yourself, as above.
- **Pages that show another document**, such as a menu, a page that lists the documents below it, breadcrumbs or a sitemap. They aren't listed. Purge them by a tag, or purge everything with `revalidatePath('/', 'layout')`.
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

If a document moves back to its old path, you get two redirects that point at each other. Before you save a redirect, remove the redirects whose `from` is its `to`.

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

- It runs after the plugin's own work, inside the request of the save or the delete. The save waits for it, even when it is async.
- If it throws, the save fails. Catch what shouldn't stop an editor from publishing, or skip the work on a flag of your own in `req.context`, as above.
- With transactions, it runs before the save is committed. Pass `req` to what you write, as the redirects above do, so it is undone if the save fails.

<details>
<summary>Good to know</summary>

If a visitor asks for a page between your purge and the commit, the old version is cached. This is true for any Payload hook that purges, and the next publish of the page fixes it.

</details>
