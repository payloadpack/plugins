---
title: Installation
description: Add the package, add the plugin, and create a migration on Postgres and SQLite.
---

## Install the package

```sh
bun add @payloadpack/path
```

With another package manager, run `npm install`, `pnpm add` or `yarn add` instead. Its peer dependencies are `payload`, `@payloadcms/ui` and `react`.

## Add the plugin

```ts title="payload.config.ts"
import { pathPlugin } from '@payloadpack/path'

export default buildConfig({
  plugins: [pathPlugin({ collections: ['pages', 'posts'] })]
})
```

Pages and posts now have a slug, a parent and their path in the sidebar. A page sits below a page and a post below a post. To start the posts at `/blog`, list them as `{ slug: 'posts', basePath: '/blog' }`, a [base path](/path/configuration/#collections). List `pathPlugin()` after any plugin that adds one of its collections.

A collection whose documents never sit below each other, as posts often don't, takes `parent: false`, and a collection with Payload's `hierarchy` keeps Payload's parent in place of the plugin's. See [Collections](/path/configuration/#collections).

The slug field has an admin component, `@payloadpack/path/client#SlugField`, so the admin's import map must hold it. Payload's dev server regenerates the import map. Otherwise run:

```sh
bunx payload generate:importmap
```

## Transactions

The plugin works with database transactions and without them, on MongoDB, Postgres and SQLite. It reads and writes through Payload's own database API, so there is nothing to set up per database.

With transactions, a save, move or delete that fails leaves everything as it was. Without them, which is SQLite's default, a move that stops halfway leaves some documents at their old paths, and [`backfillPaths`](/path/api/backfill-paths/) puts them right.

## Migrate Postgres and SQLite

The plugin adds [its fields](/path/configuration/#the-fields-it-adds) to each collection, so on Postgres and SQLite create a migration for them:

```sh
bunx payload migrate:create
```

With `push: true` in development, Payload adds the columns on its own.

## Documents you already have

The plugin gives a document its path when it is saved. For the documents from before the plugin, run [`backfillPaths`](/path/api/backfill-paths/) once, in a script or in a [migration of its own](/path/api/backfill-paths/#how-to-run-it):

```ts
import { backfillPaths } from '@payloadpack/path'

const { left, unchanged, updated } = await backfillPaths({ payload })
```

A collection with [Payload's hierarchy](/path/configuration/#payloads-hierarchy) that already has documents with parents needs this run before anything in it is deleted.

A collection that already has a `slug` or a `parent` field keeps what its documents hold in them. The plugin [adds its own](/path/configuration/#when-the-config-is-wrong) fields with those names, so remove yours first, or remove `@payloadcms/plugin-nested-docs` from your config when it is what adds `parent`. The run then makes each document's path from the slugs and parents that are there. In a site with localization, a slug that isn't localized today stays one slug with [`localized: false`](/path/configuration/#one-path-in-every-locale).

## Generate types

```sh
bunx payload generate:types
```

Your documents then have `slug` and `path` in their types, and `parent` and `ancestors` in a collection that [has them](/path/configuration/#the-fields-it-adds).
