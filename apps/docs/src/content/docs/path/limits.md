---
title: Limits
description: What two requests at the same time, a bulk update or a database without transactions can leave behind, and what puts it right.
---

The plugin reads and writes through Payload's own database API, so it runs on MongoDB, Postgres and SQLite with nothing to set up. Through that API it can't hold a document still between reading it and writing it, so two requests that change the same documents within moments of each other can get in each other's way. These are the cases we know of.

## Two requests at the same time

| When                                                                                               | What it leaves                                                                                                                                                                                                  | What puts it right                                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Two documents are saved to the same path in the same instant                                       | Each save checks the path before it writes, so both can pass. Both stay at the path, and `findByPath` returns one of them                                                                                       | Give one of them another slug or parent. A run of [`backfillPaths`](/path/api/backfill-paths/) lists both |
| A draft is saved in the moment a move of a document above it writes that document's latest version | The move reads the latest version again right before it writes it, and a save of that same version that lands in between, such as an autosave, is written over                                                  | Save the draft again                                                                                      |
| A document is deleted in the moment a move of a document above it writes that document             | On Postgres the move's write brings the document back. On SQLite we expect the same and haven't seen it                                                                                                         | Delete it again                                                                                           |
| A document gets a new slug or parent while a move of a document above it is under way              | The move leaves that document and the documents below it as they are, so they stay at paths below where the document above used to be. `onPathsChanged` still names them with the paths the move meant for them | Run `backfillPaths`                                                                                       |

A move writes the documents below one by one, so the bigger the branch, the longer the last three can happen. [Speed](/path/speed/) has what a branch of 1,000 pages takes. A save of the document itself in that moment is kept: the move writes a document only while it is as the move read it, and takes it again when a save came first. A document in a collection without timestamps, or one whose `updatedAt` Payload didn't write, as an import may leave it, is written as before, so there such a save is written over. Without transactions on Postgres and SQLite, where a save is several statements, we haven't tested that. A run of `backfillPaths` writes each document and its latest version the same way.

## Bulk updates and deletes

Payload runs the documents of a bulk update at the same time, and handles each on its own.

- A document the plugin refuses is listed in the operation's `errors`, and the others are saved or deleted. The plugin never tries a refused document again.
- The refusal shows as Payload's own line, such as "The following field is invalid: slug", without the plugin's message. Save that document on its own to get the message.
- When two documents of one bulk update would land on the same path, one of them is refused. It is refused also when the other ends up refused for a reason of its own. Then neither is at the path, and saving it again goes through.
- A bulk delete that deletes a document and one below it reports each delete to [`onPathsChanged`](/path/api/on-paths-changed/) on its own, in either order.
- A bulk update or delete that a hook starts inside another one, for the same collection and on the same request, takes over what the outer one kept. Two documents of an outer bulk update can then land on the same path, as two saves in the same instant can, and the lifts of an outer bulk delete no longer wait for each other.

## Without transactions

With transactions, a save, move or delete that fails leaves everything as it was, also when the refusal comes after Payload's write. Without them, which is SQLite's default:

| When                                                                                                         | What it leaves                                                                                                                                                                  | What puts it right                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A move stops halfway                                                                                         | Some documents keep their old paths                                                                                                                                             | Run `backfillPaths`                                                                      |
| A published document with a pending move is unpublished, and a document below it would land on a taken path  | Only Payload's write decides that the save unpublishes, so the refusal comes after it. The document is unpublished at its new path, and the documents below keep their old ones | Give that document, or the one at the taken path, another slug, then run `backfillPaths` |
| A plugin registered after this one refuses a delete in a `beforeDelete` hook, which then runs after the lift | The documents below stay lifted, and the document is still there                                                                                                                | Give them their parent back                                                              |

Your collection's own `beforeDelete` hooks run before the lift, so a delete they refuse lifts nothing.

## What would close them

- **Transactions** close everything in the section above today. See [Installation](/path/installation/#transactions).
- **A draft's save written over by a move** needs what a document has: a write that only lands when the version is as the move read it. The form of that write that Payload's types allow makes a new version on Postgres and SQLite, so the plugin doesn't use it.
- **A deleted document a move brings back** needs Payload to write a document with an update. On Postgres and SQLite it writes with an insert that updates the document when it is there, and so can insert it when it is gone.
- **A new slug or parent during a move** needs the move to put that document right itself, which isn't built, or Payload to hold a branch still for as long as a move takes, which its database API can't.
- **Two saves of the same path in the same instant** need the database to hold each path once, with a unique index. An index covers one collection and a path is unique across all of them, so it would take a collection of the plugin's own that holds every taken path. It isn't built.
