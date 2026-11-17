<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/payloadpack/plugins/main/.github/assets/icons/logo-light.svg">
    <img width="64" height="64" alt="" src="https://raw.githubusercontent.com/payloadpack/plugins/main/.github/assets/icons/logo-dark.svg">
  </picture>
</p>

<h1 align="center">@payloadpack/path</h1>

<p align="center">Stored URL paths for Payload 4 pages and posts.<br>Editors pick a parent and a slug, and your site finds the document at a path in one indexed query.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@payloadpack/path"><img alt="npm version" src="https://img.shields.io/npm/v/@payloadpack/path"></a>
  <a href="https://github.com/payloadpack/plugins/actions/workflows/ci.yml"><img alt="Build status" src="https://github.com/payloadpack/plugins/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://payloadcms.com"><img alt="Payload version" src="https://img.shields.io/npm/dependency-version/@payloadpack/path/peer/payload"></a>
  <a href="https://github.com/payloadpack/plugins/blob/main/packages/path/LICENSE"><img alt="PolyForm Perimeter license" src="https://img.shields.io/badge/license-PolyForm%20Perimeter-blue"></a>
</p>

<p align="center">
  <a href="https://docs.payloadpack.com/path/"><b>Documentation</b></a> ·
  <a href="https://docs.payloadpack.com/path/installation/">Installation</a> ·
  <a href="https://github.com/payloadpack/plugins/blob/main/packages/path/CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/payloadpack/plugins/blob/main/CONTRIBUTING.md">Contributing</a>
</p>

## What you get

- 🧭 **A stored path** on every page and post, made from its parent and its slug, below an optional base path such as `/blog`
- 🔒 **One document per path**, across all your collections and drafts too, and a refusal that names what is in the way
- 🌳 **Branches that move along**: rename or move a page or a post, and everything below it follows
- 🏠 **A home page at `/`**, and the slugs your site keeps for itself
- 🌍 **A path per language**, with the locale left out of it
- ⚡ **One indexed query per collection** to find what a path shows

## Install

```sh
bun add @payloadpack/path
```

```ts
import { pathPlugin } from '@payloadpack/path'

export default buildConfig({
  plugins: [pathPlugin({ collections: ['pages', 'posts'] })]
})
```

Pages and posts now have a slug, a parent and their path in the sidebar. A page sits below a page and a post below a post. On Postgres or SQLite, create a migration for the new fields.

Then your site's catch-all route asks for the document at a path:

```ts
import { findByPath } from '@payloadpack/path'

const found = await findByPath({ path: '/about/team', payload })
// { collection: 'pages', document: { id, title, path: '/about/team', ... } }, or null
```

## Transactions

The plugin works with database transactions and without them, on MongoDB, Postgres and SQLite. It reads and writes through Payload's own database API, so there is nothing to set up per database.

With transactions, a save, move or delete that fails leaves everything as it was. Without them, which is SQLite's default, a move that stops halfway leaves some documents at their old paths, and `backfillPaths` puts them right.

## Configure

| Key                   | What it sets                                                                                               | Default                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `collections`         | The collections whose documents get a path, each by its slug or as `{ slug, basePath, parent, localized }` |                                               |
| `rootSlug`            | The slug that makes a top-level document the home page at `/`                                              | `home`                                        |
| `reservedSegments`    | Segments your site serves itself, at the root or at any depth, as a list or each with why                  | Payload's admin and API routes                |
| `slugify`             | What makes a slug from a title and from what an editor types, as in Payload's own slug field               | Accents off Latin letters, other scripts kept |
| `maxDocumentsPerMove` | The most documents one move or delete may carry                                                            | `1000`                                        |
| `onPathsChanged`      | A function that hears which paths changed, so you can purge your cache                                     | none                                          |

A collection given as `{ slug: 'posts', basePath: '/blog' }` puts its top-level documents below `/blog`, as in `/blog/hello-world`. The base path is optional, and a path still belongs to one document across all your collections.

Each collection decides where a document's parent comes from:

- On its own, a collection gets the plugin's parent field, so a page sits below a page.
- With `parent: false` its documents have no parent, so a post's path is `/blog`, a slash and its slug.
- With Payload's own `hierarchy` on the collection, the plugin uses Payload's parent and you keep Payload's tree in the admin. There is nothing to set in the plugin for it.

Every option and every message an editor can meet are in the [docs](https://docs.payloadpack.com/path/configuration/).

## Languages

With localization, each locale has a path of its own, made from its own slug, or from the slug it falls back to when it has none. The locale is never part of the path, so your routes decide where it goes:

```ts title="app/[locale]/[[...segments]]/page.tsx"
const found = await findByPath({ locale, path: `/${(segments ?? []).join('/')}`, payload })
```

The same path may show different documents in different languages, and each language is published on its own.

A collection given with `localized: false` has one slug and one path for every language instead, which fits documents such as products that keep the same address everywhere.

## Speed

A lookup is one indexed query per collection, and none for a path your site reserves.

<!-- speed-table:start -->

The median and 95th percentile (p95) of each, on a database with 100,000 documents. Run on 2026-11-17, on Apple M3 Max with 128 GB of memory and Node 26.13.1.

Without localization:

| Operation           | MongoDB             | Postgres            | SQLite              |
| ------------------- | ------------------- | ------------------- | ------------------- |
| Lookup by path      | 0.3 ms (p95 0.4 ms) | 0.5 ms (p95 0.8 ms) | 0.3 ms (p95 0.4 ms) |
| Autosave            | 9.2 ms (p95 16 ms)  | 4.6 ms (p95 6 ms)   | 47 ms (p95 59 ms)   |
| Publish, same slug  | 9.3 ms (p95 13 ms)  | 4.6 ms (p95 6 ms)   | 26 ms (p95 27 ms)   |
| Publish, new slug   | 11 ms (p95 14 ms)   | 6.2 ms (p95 8.7 ms) | 29 ms (p95 38 ms)   |
| Move of 1,000 pages | 315 ms (p95 391 ms) | 965 ms (p95 980 ms) | 681 ms (p95 707 ms) |

With localization (two locales):

| Operation           | MongoDB             | Postgres            | SQLite              |
| ------------------- | ------------------- | ------------------- | ------------------- |
| Lookup by path      | 0.3 ms (p95 0.6 ms) | 0.7 ms (p95 1 ms)   | 0.3 ms (p95 0.7 ms) |
| Autosave            | 10 ms (p95 14 ms)   | 6.9 ms (p95 8 ms)   | 51 ms (p95 54 ms)   |
| Publish, same slug  | 12 ms (p95 14 ms)   | 8.1 ms (p95 9.2 ms) | 29 ms (p95 34 ms)   |
| Publish, new slug   | 11 ms (p95 17 ms)   | 11 ms (p95 14 ms)   | 30 ms (p95 35 ms)   |
| Move of 1,000 pages | 432 ms (p95 464 ms) | 1.5 s (p95 1.7 s)   | 977 ms (p95 1 s)    |

<!-- speed-table:end -->

The [speed page](https://docs.payloadpack.com/path/speed/) has what was measured, and how to run the benchmark yourself.

## Requirements

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

## License

Use it in any project, including client work you charge for and products you sell. What you can't do is offer the plugin, or a copy or fork of it, to others as a competing plugin, paid or free. The terms are the [PolyForm Perimeter License 1.0.1](https://github.com/payloadpack/plugins/blob/main/packages/path/LICENSE).
