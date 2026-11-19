---
title: Limits
description: The few cases where a document can end up at a wrong path or in a wrong state, when each can happen, and what to do about it.
---

In everyday use you won't meet any of these. Most are timing cases: two changes have to hit the same documents in the same moment, the gap any code has that checks first and writes after without a lock in the database. Each one says how likely it is, what you would see and what to do.

## Two changes at the same moment

### Two documents end up at the same path

- **When:** two documents are saved with the same path in the same instant.
- **How likely:** very unlikely. Two saves have to give two different documents the same path within a fraction of a second. A script that creates documents in parallel with the same slug can do it, and two editors hardly can.
- **What you see:** both saves go through, and `findByPath` returns one of the two.
- **What to do:** give one of them another slug or parent. A run of [`backfillPaths`](/path/api/backfill-paths/) lists both.

### A document stays at its old path after the document above it moved

- **When:** a document gets a new slug or parent while a rename or move of a document above it is still running. A big branch takes a while, and [Speed](/path/speed/) has how long.
- **How likely:** unlikely. Someone has to rename or move a document inside a branch in the time a move of that branch takes.
- **What you see:** that document and the documents below it stay below the old path. [`onPathsChanged`](/path/api/on-paths-changed/) has named them with their new paths all the same.
- **What to do:** run `backfillPaths`.

### A deleted document comes back

- **When:** on Postgres, a document is deleted in the very moment a rename or move of a document above it gets to it.
- **How likely:** very unlikely. The delete has to land in the moment the move writes that one document.
- **What you see:** the document is there again, without its versions.
- **What to do:** delete it again.

## Bulk updates

### A refused document shows no message from the plugin

- **When:** a bulk update holds a document the plugin refuses.
- **How likely:** every time that happens. Nothing is wrong with your documents: only the message is missing.
- **What you see:** the document is listed in the operation's `errors` with Payload's own line, such as "The following field is invalid: slug".
- **What to do:** save that document on its own to get the [message](/path/refusals/).

### Two documents of one bulk update aim for the same path

- **When:** one bulk update would put two documents at the same path.
- **How likely:** only when one bulk update gives two documents the same slug below the same parent. Nothing is wrong with your documents.
- **What you see:** one of them is refused. When the other is refused too, for a reason of its own, neither ends up at the path.
- **What to do:** save the refused document again.

## Without transactions

With transactions, a save, move or delete that fails leaves everything as it was. This one can only happen without them, which is SQLite's default. See [Installation](/path/installation/#transactions).

### A move stops halfway

- **When:** a move fails partway through, such as when the server stops.
- **How likely:** only when the server or the database fails in the middle of a move.
- **What you see:** some of the documents below keep their old paths.
- **What to do:** run `backfillPaths`.

## Why they are here

The plugin reads and writes through Payload's own database API, so it runs on MongoDB, Postgres and SQLite with nothing to set up. Each limit comes from something that API or the databases don't offer today.

| Limit                                           | What would close it                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Two documents at the same path                  | A unique index across collections, which none of the three databases has. The check before each save is what keeps them apart |
| A document at its old path after a move         | A way to hold a branch still while a move runs                                                                                |
| A deleted document that comes back              | Payload writing a document with an update. On Postgres it writes with an insert that updates the document when it is there    |
| A refused document without the plugin's message | Payload passing the message of a refusal on in a bulk update's `errors`                                                       |
| A move that stops halfway                       | Transactions, which you can turn on today                                                                                     |
