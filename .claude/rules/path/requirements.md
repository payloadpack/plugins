---
paths:
  - 'packages/path/**'
  - 'apps/path-demo/**'
  - 'apps/docs/src/content/docs/path/**'
  - 'apps/docs/src/components/path/**'
  - 'apps/docs/src/data/path-*'
---

# Path requirements

What the package does, as its owner confirmed it. Build to this list, and ask him before changing it.

- A path is the parent's path, a slash and the slug.
  - A parent is a document of the same collection.
  - A collection uses the plugin's own parent field, the parent of Payload's own hierarchy, or no parent at all.
  - A collection can start below a base path, such as `/blog`.
  - The path is stored on the document and indexed, and only the plugin writes it.
- A path is unique across the collections given to the plugin.
  - A draft takes its path too.
  - A pending move takes nothing until the document moves.
  - With localization, a path is unique per locale.
  - A document in the trash takes no path.
  - A taken path is refused. The plugin never renames around it.
- A document without a slug takes one from its title, and a slug is cleaned on every save.
  - A changed title never changes a slug.
  - A draft without a slug has no path yet, and can't be published.
  - A site can pass its own `slugify`.
  - The slug field has Payload's lock.
  - A duplicate gets `-copy`.
- Saving a draft of a published document moves nothing.
  - The document moves when it gets the new slug or parent itself: a publish, an unpublish or a restored version.
  - A document that isn't published follows its draft at once.
- A move takes the whole branch along, latest versions too.
  - Refused when it carries more than `maxDocumentsPerMove` documents, 1,000 by default.
  - Refused when a document of the branch would land on a taken path.
- A delete lifts the documents below it one level.
  - Refused when one of them can't land.
  - Also with Payload's hierarchy, which on its own deletes them.
- The top-level document with the root slug is the home page at `/`.
  - The home page has no documents below it.
- Reserved segments are refused, at the root or at any depth.
  - Payload's admin and API routes are reserved by default.
- With localization, each locale has its own slug and path.
  - A collection can have one slug and one path for every locale instead, with `localized: false`.
  - A locale without a slug uses the one it falls back to.
  - The locale is never part of the path.
  - Publishing one locale never moves another that has a slug of its own.
- A refusal comes before anything is written.
  - It names what is in the way and what to change.
- It works with transactions and without.
  - With them, a failed save, move or delete leaves everything as it was.
  - Without them, a move that stops halfway is put right by `backfillPaths`.
- `findByPath` finds the document at a path in one indexed query per collection.
- `onPathsChanged` hears every published path that changed, and where a branch moved from and to.
- `backfillPaths` gives the documents a site already has their paths.
- It reads and writes through Payload's own database API, with no SQL or database code of its own.
- It runs on Payload 4.0.0-beta.9 or later, with MongoDB, Postgres or SQLite.
  - With drafts and without, with localization and without.
- Not in it: a parent in another collection, a base path per locale, refusals in other languages than English, paths per tenant.
