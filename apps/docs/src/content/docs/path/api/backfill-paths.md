---
title: backfillPaths
description: Give the documents you already have their paths, and put right a move that stopped halfway.
---

```ts
import { backfillPaths } from '@payloadpack/path'

const { left, unchanged, updated } = await backfillPaths({ payload })
```

Run it once after you add the plugin, in a script or a migration, and after a move that stopped halfway on a database without transactions. [Limits](/path/limits/) has the other cases it puts right.

| In the result | What it holds                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updated`     | How many documents got another path or other ancestors, in the document or its latest version                                                                    |
| `unchanged`   | How many documents had theirs already                                                                                                                            |
| `left`        | Each document it left as it was, as `{ collection, id, refusal }`, with the message a save of it would get, or the one that names the other document at its path |

- It gives every document the path its slug and its parent make, parents first, and writes only what differs, in the document and in its latest version.
- It makes no new version, runs no hook of the collection and doesn't call `onPathsChanged`. A draft's new slug or parent on a published document stays a pending move.
- It makes up no slug. A document without one is left with the [refusal](/path/refusals/#slug-and-parent) a save would get, and so is every document below it.
- It writes each document on its own, so a run that stopped can be run again, and a second run writes nothing.
- It reads each document again when it gets to it, so an edit saved before then is kept.
- Two documents that ended up [at the same path](/path/paths/#one-document-per-path) are both left and listed, each with the message that names the other. Give one of them another slug or parent, and the next run lists neither.
- A collection with Payload's hierarchy that already has parents needs it before anything in it is deleted. See [Moves and deletes](/path/moves-and-deletes/#deletes).
- To run it on some of the plugin's collections, pass `collections: ['pages']`. A collection the plugin wasn't given stops it with:

> @payloadpack/path was asked for collections that pathPlugin() wasn't given: notices.
