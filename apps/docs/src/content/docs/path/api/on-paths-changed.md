---
title: onPathsChanged
description: Hear which paths changed after a publish, a move or a delete, so your site can purge its cache.
---

```ts title="payload.config.ts"
import { revalidatePath } from 'next/cache'

pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: ({ paths, moved, lifted }) => {
    for (const { path } of paths) revalidatePath(path)
    // Everything below a moved or deleted document has a new path, so purge the whole site, or a tag you keep per branch.
    if (moved?.documentsBelow || lifted) revalidatePath('/', 'layout')
  }
})
```

## What it hears

```ts
type PathsChange = {
  paths: { path: string; locale?: string }[]
  moved?: BranchChange
  lifted?: BranchChange
}

type BranchChange = {
  collection: string
  id: number | string
  documentsBelow: number
  paths: { from: string; to: string; locale?: string }[]
}
```

| After                    | `paths`                                                                             | `moved` or `lifted`                                    |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A publish                | The path it published at, and the one it left if it moved                           | `moved`, if it moved                                   |
| A move                   | The document's new path and old path                                                | `moved`                                                |
| An unpublish             | The path it was unpublished at                                                      | `moved`, if it moved                                   |
| A delete                 | The path it was published at                                                        | `lifted`, when documents below it were lifted          |
| Into or out of the trash | The path of a published document sent to the trash, or taken out of it as published |                                                        |
| A draft save             | Nothing                                                                             | `moved`, when it moved a document that isn't published |

- `moved` names the document a save moved, and `lifted` the document a delete removed when documents below it were lifted. Both name the collection as well as the id, since a page and a post may share an id on Postgres and SQLite.
- In both, every path that started with `from` and a slash now starts with `to` and a slash. For `lifted`, `to` is the parent's path, the collection's base path, or an empty string at the root.
- A rename of a document with nothing below it reports `moved` with `documentsBelow: 0`, and a publish that keeps the slug and the parent reports none.
- It isn't called when there is nothing to report. A delete of a document in the trash reports no `paths`, since your site heard them when it went there, and still reports `lifted`.
- With localization, each path has its `locale`, and only the locales the save changed are listed, which usually includes the ones that fall back to a renamed slug.
- A collection given with `localized: false` is reported in the same shape: its one path is listed once for each locale your site finds the document in, and a move's `from` and `to` come per locale.

## Redirects

`moved` and `lifted` hold what a redirect needs:

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: async ({ moved, lifted }) => {
    for (const { from, to, locale } of (moved ?? lifted)?.paths ?? []) {
      // saveRedirect is yours. After a move, `from` itself is at `to` too.
      await saveRedirect({ from, to, locale })
    }
  }
})
```

## When it runs

After the plugin's own work, inside the save's request, with `req` as its second argument. A throw fails the save, so catch what shouldn't stop an editor from publishing.
