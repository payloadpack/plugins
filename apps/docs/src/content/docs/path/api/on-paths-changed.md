---
title: onPathsChanged
description: Receive each document's old and new path after a publish, move, or delete so you can purge caches and manage redirects.
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

## Arguments

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

| Event                                 | `from`       | `to`          |
| ------------------------------------- | ------------ | ------------- |
| Publish                               | `null`       | The path      |
| Re-publish with the same path         | The path     | The same path |
| Unpublish, delete, or move to trash   | The path     | `null`        |
| Restore from trash (as published)     | `null`       | The path      |
| Move                                  | The old path | The new path  |
| Move or delete of a document above it | The old path | The new path  |

- **Order:** One entry per published document per locale — the saved or deleted document first, then documents below it top-down.
- **Published only:** Draft saves on published docs and unpublished docs produce no entries. Moving an unpublished document still lists published documents below it.
- **Collection + ID:** Both are included because two collections can share the same numeric ID on Postgres and SQLite.

<details>
<summary>More cases (trash, localization, bulk deletes)</summary>

- **Empty list:** `onPathsChanged` isn't called when nothing changed. Permanently deleting a trashed document omits that document (already reported when sent to the trash) while still listing lifted documents below it.
- **Large branches:** Moving a branch of thousands emits thousands of entries — one for every published document below.
- **Localization:** Each entry includes `locale`, listing only changed locales (including locales falling back to a renamed slug). Collections with [one path in every locale](/path/languages/#one-path-in-every-locale) emit one entry per published locale.
- **Bulk deletes:** Deleting a document and a document below it in one bulk delete reports each delete separately, in either order. Each lifted document shows its new `to` path; a document lifted and then deleted in the same bulk delete appears in both (with `to` in the parent's delete, and `to: null` in its own).

</details>

## What else to purge

```ts
for (const { locale, from, to } of changedPaths) {
  for (const path of [from, to]) {
    if (path) revalidatePath(`/${locale}${path === '/' ? '' : path}`)
  }
}
```

- **Locale prefixes:** Stored paths never include the locale — prepend it yourself if your URLs use a prefix like `/sv`.
- **Pages showing other documents:** Menus, listings, breadcrumbs, and sitemaps aren't in `changedPaths`. Purge them with cache tags or `revalidatePath('/', 'layout')`.
- **After `backfillPaths`:** Backfills don't call `onPathsChanged`, so purge your cache once after a run that updated documents.

## Redirects

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  onPathsChanged: async ({ changedPaths, payload, req }) => {
    for (const { from, to, locale } of changedPaths) {
      if (!from || !to || from === to) continue
      // Passing req ensures this redirect rolls back if the save fails.
      await payload.create({
        collection: 'redirects',
        data: { from, to, locale },
        overrideAccess: true,
        req
      })
    }
  }
})
```

Before saving a redirect, delete any existing redirect whose `from` equals the new `to` — otherwise moving a document back to an old path creates a redirect loop.

## When it runs

```ts
// Seed scripts and jobs run outside a Next.js request,
// where revalidatePath throws and fails the save.
await payload.create({
  collection: 'pages',
  context: { seeding: true },
  data: { title: 'About' }
})
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

- Runs inside the save or delete request after the plugin's work finishes. Async callbacks are awaited.
- If `onPathsChanged` throws, the save fails — catch non-critical failures or guard with a flag in `req.context`, as above.
- With transactions, it runs before commit. Pass `req` to any writes (as in the redirects example) so they roll back if the save fails.

<details>
<summary>Cache timing with transactions</summary>

If a visitor requests a page in the brief moment between your purge and the database commit, the old version gets cached again. This applies to any Payload hook that purges caches, and the next publish fixes it.

</details>
