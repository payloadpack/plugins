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
    // Each published document below a moved or deleted one has a new path too.
    for (const document of (moved ?? lifted)?.documents ?? []) {
      for (const { from, to } of document.paths) {
        revalidatePath(from)
        revalidatePath(to)
      }
    }
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
  documents: { id: number | string; paths: { from: string; to: string; locale?: string }[] }[]
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
- `documents` names each document below that your site finds at another path now, top-down, with the path it left and the one it is at, in each locale it is published in. A document below that isn't published is not listed, so there can be fewer than `documentsBelow`.
- A rename of a document with nothing below it reports `moved` with `documentsBelow: 0`, and a publish that keeps the slug and the parent reports none.
- It isn't called when there is nothing to report. A delete of a document in the trash reports no `paths`, since your site heard them when it went there, and still reports `lifted`.
- With localization, each path has its `locale`, and only the locales the save changed are listed, which usually includes the ones that fall back to a renamed slug.
- A collection given with `localized: false` is reported in the same shape: its one path is listed once for each locale your site finds the document in, and a move's `from` and `to` come per locale.

## Redirects

`moved` and `lifted` hold what a redirect needs: the moved document's own paths, and those of each published document below it.

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: async ({ moved, lifted }) => {
    // A moved document is at its new path. A deleted one is gone, so only the documents below it get a redirect.
    const own = moved?.paths ?? []
    const below = (moved ?? lifted)?.documents.flatMap((document) => document.paths) ?? []
    for (const { from, to, locale } of [...own, ...below]) {
      // saveRedirect is yours.
      await saveRedirect({ from, to, locale })
    }
  }
})
```

For a branch too big to keep a redirect per document, `paths` on `moved` or `lifted` gives one rule per locale instead: every path that starts with `from` and a slash goes to the same path below `to`. After a delete at the root `to` is an empty string, so `/about/team` goes to `/team`.

## When it runs

After the plugin's own work, inside the save's request, with `req` as its second argument. A throw fails the save, so catch what shouldn't stop an editor from publishing.
