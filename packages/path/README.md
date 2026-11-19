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

| Key                | What it sets                                                                                               | Default                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `collections`      | The collections whose documents get a path, each by its slug or as `{ slug, basePath, parent, localized }` |                                               |
| `rootSlug`         | The slug that makes a top-level document the home page at `/`                                              | `home`                                        |
| `reservedSegments` | Segments your site serves itself, at the root or at any depth, as a list or each with why                  | Payload's admin and API routes                |
| `slugify`          | What makes a slug from a title and from what an editor types, as in Payload's own slug field               | Accents off Latin letters, other scripts kept |
| `onPathsChanged`   | A function that hears which paths changed, so you can purge your cache                                     | none                                          |

A collection given as `{ slug: 'posts', basePath: '/blog' }` puts its top-level documents below `/blog`, as in `/blog/hello-world`. The base path is optional, and a path still belongs to one document across all your collections.

Each collection decides where a document's parent comes from:

- On its own, a collection gets the plugin's parent field, so a page sits below a page.
- With `parent: false` its documents have no parent, so a post's path is `/blog`, a slash and its slug.
- With Payload's own `hierarchy` on the collection, the plugin uses Payload's parent and you keep Payload's tree in the admin. There is nothing to set in the plugin for it.

Every option and every message an editor can meet are in the [docs](https://docs.payloadpack.com/path/configuration/).

## Languages

With localization, a collection's documents keep one slug and one path for every language, so a site that gets localization later keeps the paths it has. A collection given with `localized: true` has a path per locale instead, made from each locale's own slug, or from the slug it falls back to when it has none:

```ts title="payload.config.ts"
pathPlugin({ collections: [{ slug: 'pages', localized: true }] })
```

The locale is never part of the path, so your routes decide where it goes:

```ts title="app/[locale]/[[...segments]]/page.tsx"
const found = await findByPath({ locale, path: `/${(segments ?? []).join('/')}`, payload })
```

With a path per locale, the same path may show different documents in different languages, and each language is published on its own.

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

Payload 4.0.0-beta.10 or later, with MongoDB, Postgres or SQLite.

## License

Use it in any project, including client work you charge for and products you sell. What you can't do is offer the plugin, or a copy or fork of it, to others as a competing plugin, paid or free. The terms are the [PolyForm Perimeter License 1.0.1](https://github.com/payloadpack/plugins/blob/main/packages/path/LICENSE).
