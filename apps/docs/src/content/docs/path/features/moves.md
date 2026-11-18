---
title: Moves
description: Rename or move a document, and every document below it follows.
---

When an editor publishes a document with a new slug or a new parent, every document below it gets its new path and ancestors. Publishing the page `/harbour` as `/port` moves `/harbour/ferries/timetable` to `/port/ferries/timetable`. It is the same in every collection whose documents have a parent. With [Payload's hierarchy](/path/configuration/#payloads-hierarchy), an editor picks the new parent with the button in the document's header.

A document's branch stays in its own collection, so a move rewrites only that collection and its versions. In a collection given with [`parent: false`](/path/configuration/#no-parent) nothing sits below a document, so a rename moves that document alone.

## Drafts and versions

- A move happens when the document itself takes the new slug or parent, as it does when it is published. Saving the rename as a draft of a published document moves nothing yet.
- A document that isn't published follows its draft at once, so saving the rename as a draft moves it and the documents below it.
- Unpublishing a document, or updating it through the API without `draft`, writes its latest draft to the document itself. When that draft has a new slug or parent, the documents below it move then.
- A document below it moves in its latest version too, so a pending draft keeps the slug it plans under the new path.
- Older versions keep the paths they had. A restored version takes its path from its parent and slug again.

## A big branch

A move is never refused for its size. It writes the documents below one by one, inside the request of the save, so a branch of many thousands takes a while. The [speed page](/path/speed/) has what a move of 1,000 pages takes.

## Where the branch lands

Before anything changes, the move works out the new path of every document in the branch, and is refused when a document of any collection is already at one of them. That holds with [base paths](/path/features/paths/#base-paths) too: moving the page `/journal` to `/blog`, while posts sit at `/blog`, is refused when a post is at a path a page below it lands on:

> Post "Recipes post" is already at /blog/recipes, so change the slug or the parent.

## A failed move

With transactions, a move that fails halfway, because the database refuses a write or the server stops, leaves every path, ancestor and version as it was. Without them, which is SQLite's default, it leaves some documents at their old paths, and [`backfillPaths`](/path/installation/#documents-you-already-have) puts them right.

## Bulk updates

A bulk update or delete handles each document on its own. A document the plugin refuses is listed in the operation's `errors`, and the others are saved or deleted, as Payload does with any document that fails. With the MongoDB adapter's `bulkOperationsSingleTransaction`, a bulk update saves the ones after the refused document, and Payload 4.0.0-beta.9 undoes the ones it saved before it, while its result still lists them.
