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

Pages and posts now have a slug, a parent and their path in the sidebar. A page sits below a page and a post below a post. To start the posts at `/blog`, list them as `{ slug: 'posts', basePath: '/blog' }`, a [base path](/path/features/paths/#base-paths). List `pathPlugin()` after any plugin that adds one of its collections.

A collection whose documents never sit below each other, as posts often don't, takes `parent: false`, and a collection with Payload's `hierarchy` keeps Payload's parent in place of the plugin's. See [Collections](/path/configuration/#collections).

The slug field has an admin component, `@payloadpack/path/client#SlugField`, so the admin's import map must hold it. Payload's dev server regenerates the import map. Otherwise run:

```sh
bunx payload generate:importmap
```

## Transactions

The plugin works with database transactions and without them, on MongoDB, Postgres and SQLite. It reads and writes through Payload's own database API, so there is nothing to set up per database.

With transactions, a save, move or delete that fails leaves everything as it was. Without them, which is SQLite's default, a move that stops halfway leaves some documents at their old paths, and [`backfillPaths`](#documents-you-already-have) puts them right.

## Migrate Postgres and SQLite

The plugin adds [its fields](/path/configuration/#the-fields-it-adds) to each collection, so on Postgres and SQLite create a migration for them:

```sh
bunx payload migrate:create
```

With `push: true` in development, Payload adds the columns on its own.

## Documents you already have

The plugin gives a document its path when it is saved. For the documents from before the plugin, run `backfillPaths` once, in a script or a migration:

```ts
import { backfillPaths } from '@payloadpack/path'

const { left, placed, unchanged } = await backfillPaths({ payload })
```

It gives every document the path its slug and its parent make, parents before the documents below them, and writes only what differs, in the document and in its latest version. It makes no new version, runs no hook of the collection and doesn't call `onPathsChanged`. A draft's new slug or parent on a published document stays a pending move.

It makes up no slug. A document without one is listed in `left` with this message, and a save gives it a slug from its title:

> Give this document a slug, or a title to make one from.

| In the result | What it holds                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `placed`      | How many documents got another path or other ancestors, in the document or its latest version              |
| `unchanged`   | How many documents had theirs already                                                                      |
| `left`        | Each document it couldn't place, as `{ collection, id, refusal }`, with the message a save of it would get |

A document below one that was left without a path is left too, with this message:

> The parent has no path yet, so save the parent first.

It writes each document on its own, so a run that stopped can be run again, and a second run writes nothing. It also puts right a move that stopped halfway on a database without transactions.

A collection with [Payload's hierarchy](/path/configuration/#payloads-hierarchy) that already has documents with parents needs this run before anything in it is deleted. Until then a delete also deletes the documents right below, as Payload does on its own.

To run it on some of the plugin's collections, pass `collections: ['pages']`. A collection the plugin wasn't given stops it with:

> @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.

## Generate types

```sh
bunx payload generate:types
```

Your documents then have `slug` and `path` in their types, and `parent` and `ancestors` in a collection that [has them](/path/configuration/#the-fields-it-adds).
