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

Each entry of `changedPaths` is one published document in one locale: `from` is the path your site found it at before, and `to` the path it finds it at now.

| After                                     | `from`       | `to`          |
| ----------------------------------------- | ------------ | ------------- |
| A publish                                 | `null`       | The path      |
| A publish that keeps the path             | The path     | The same path |
| An unpublish, a delete, or into the trash | The path     | `null`        |
| Out of the trash, as published            | `null`       | The path      |
| A move                                    | The old path | The new path  |
| A move or a delete of a document above it | The old path | The new path  |

- The saved or deleted document comes first, then each document below it, top-down. Each entry names the collection as well as the id, since a page and a post may share an id on Postgres and SQLite.
- Only what your site shows is listed. A draft save of a published document lists nothing, and neither does a document that isn't published. When a document that isn't published moves, the published documents below it are still listed.
- It isn't called when there is nothing to list. A delete of a document in the trash lists no path of its own, since your site heard it when it went there, and still lists the documents below that were lifted.
- A move of a big branch lists every published document below it, so a branch of thousands gives thousands of entries.
- A bulk delete that deletes a document and one below it reports each delete on its own, and they may come in either order. Each lifted document is listed with where it ended up. A document that was lifted and then deleted in the same bulk delete is listed by both: with a `to` by the delete above it, and without one by its own.
- A document that a move left as it was, because a save gave it a new slug or parent meanwhile, is still listed with the path the move meant for it. See [Limits](/path/limits/#a-document-stays-at-its-old-path-after-the-document-above-it-moved).
- With localization, each entry has its `locale`, and only the locales the save changed are listed, which usually includes the ones that fall back to a renamed slug.
- A collection with one path in every locale is listed in the same shape: its one path once for each locale your site finds the document in.

## What is yours to purge

`onPathsChanged` names the documents your site finds somewhere else. Three things it leaves to you:

- **The locale in your URLs.** A path never holds the locale, so with a prefix such as `/sv` you put it in front yourself:

  ```ts
  for (const { locale, from, to } of changedPaths) {
    for (const path of [from, to]) {
      if (path) revalidatePath(`/${locale}${path === '/' ? '' : path}`)
    }
  }
  ```

- **Pages that show another document.** A menu, a page that lists the documents below it, breadcrumbs, a sitemap. The plugin knows which paths changed, and not which pages link to them or show their titles. Purge those by a tag, or all of them with `revalidatePath('/', 'layout')`.
- **A run of `backfillPaths`.** It doesn't call `onPathsChanged`, so purge everything once after a run that updated documents.

## Redirects

An entry with a `from` and another `to` is a document that moved, which is what a redirect needs.

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: async ({ changedPaths, payload, req }) => {
    for (const { from, to, locale } of changedPaths) {
      // A document that is new has no from, and one that is gone has no to. Neither gets a redirect.
      if (!from || !to || from === to) continue
      // redirects is a collection of yours. With req, the redirect is undone when the save fails.
      await payload.create({ collection: 'redirects', data: { from, to, locale }, overrideAccess: true, req })
    }
  }
})
```

A document that moves back to where it was leaves two redirects that point at each other. Before you save one, remove the redirects whose `from` is its `to`.

## When it runs

After the plugin's own work, inside the save's request. It may be async, and the save waits for it. Beside what changed, it is given `payload`, your Payload instance, and `req`, the request of the save or the delete.

- A throw fails the save, so catch what shouldn't stop an editor from publishing.
- `revalidatePath` throws outside a request of Next, such as in a seed script or a job, and every save there would fail with it. Catch it, or skip the purge on a flag of your own in `req.context`.
- With transactions it runs before the save is committed. Pass `req` to what you write, as the redirects above do, so it is undone with a save that fails. A page a visitor asks for between your purge and the commit is cached as it was, which holds for any hook of Payload that purges, and the next publish of the page puts it right.
