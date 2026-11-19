---
title: backfillPaths
description: Give the documents you already have their paths. When to run it, how to run it and what a run does.
---

The plugin gives a document its path when the document is saved through Payload. `backfillPaths` is for the documents that didn't get theirs that way. It goes through your documents and gives each one the path its slug and its parent make.

It is no step of a build or a deploy. A site that saves its documents through Payload doesn't need it again after the first run.

## When to run it

| When                                                                                                  | Why                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Once, after you add the plugin to a site that already has documents                                   | They were saved before the plugin, so they hold no path yet and `findByPath` doesn't find them       |
| After you give the plugin another collection that already has documents                               | The same, for that collection. Pass `collections: ['posts']` to go through that one only             |
| After documents were written without Payload's hooks, such as an import that writes with `payload.db` | Nothing gave them a path. An import that saves with `payload.create` needs no run                    |
| After you add or remove `localized: true` on a collection that has documents                          | Once your migration has copied the slugs. See [Languages](/path/languages/#one-path-in-every-locale) |
| When [Limits](/path/limits/) says so                                                                  | A move that stopped halfway without transactions, or a document that stayed at its old path          |

A collection with Payload's hierarchy that already has documents with parents needs the first run before anything in it is deleted. See [Moves and deletes](/path/moves-and-deletes/#deletes).

A run that nothing needed does no harm. It writes only what differs, so a second run writes nothing.

## How to run it

It is a function you call, with no command of its own. Put it in a script:

```ts
// scripts/backfill-paths.ts
import config from '@payload-config'
import { backfillPaths } from '@payloadpack/path'
import { getPayload } from 'payload'

const payload = await getPayload({ config })
const { left, unchanged, updated } = await backfillPaths({ payload })

console.log({ left, unchanged, updated })
process.exit(0)
```

```sh
bunx payload run scripts/backfill-paths.ts
```

Your site can stay up while it runs. It reads each document again when it gets to it, so an edit saved before then is kept.

In a migration, give it a migration of its own that runs after the one that adds the plugin's columns. It works outside the migration's transaction, so on Postgres a migration that changes a table and then calls it waits forever.

## What it returns

| In the result | What it holds                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updated`     | How many documents got another path or other ancestors, in the document or its latest version                                                                    |
| `unchanged`   | How many documents had theirs already                                                                                                                            |
| `left`        | Each document it left as it was, as `{ collection, id, refusal }`, with the message a save of it would get, or the one that names the other document at its path |

Look at `left` after a run. Each document in it needs a change from you before the next run can give it a path.

## What a run does

- It gives every document the path its slug and its parent make, parents first, and writes only what differs, in the document and in its latest version.
- It makes no new version, runs no hook of the collection and doesn't call `onPathsChanged`. A draft's new slug or parent on a published document stays a pending move.
- It makes up no slug. A document without one is left with the [refusal](/path/refusals/#slug-and-parent) a save would get, and so is every document below it.
- It writes each document on its own, so a run that stopped can be run again.
- Two documents that ended up [at the same path](/path/paths/#one-document-per-path) are both left and listed, each with the message that names the other. Give one of them another slug or parent, and the next run lists neither.
- A collection the plugin wasn't given stops it with:

> @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.
