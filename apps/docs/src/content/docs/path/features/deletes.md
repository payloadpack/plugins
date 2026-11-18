---
title: Deletes
description: Deleting a document lifts the documents below it one level, unless one would land somewhere it can't.
---

When an editor deletes a document, the documents below it move up one level, to the deleted document's parent or to the top level of its collection. Deleting the page `/company/team` lifts `/company/team/people` to `/company/people`, with its ancestors, its parent and its latest version. Deleting a top-level post at `/blog/series` lifts the posts below it to `/blog`.

A child may take the deleted document's own path, so deleting `/careers` with a page `/careers/careers` below it leaves that page at `/careers`.

## When a delete is refused

The delete is refused, and nothing moves, when a lifted document would land:

- on a path a document of any collection is at, at any depth below the deleted document:
  > Post "Press" is already at /press, so change the slug or the parent.
- on a reserved segment:
  > The site serves the CMS at /admin, so pick another slug or a parent.
- on `/`, as the home page:
  > Page "Start home" would become the home page at /, so change its slug first.

A document below it that was never published is checked like the others, since a draft takes its path too.

## Without a parent

In a collection given with [`parent: false`](/path/configuration/#no-parent) nothing sits below a document, so a delete lifts nothing.

## With Payload's hierarchy

On its own, Payload deletes every document right below a deleted one. With the plugin they are lifted one level instead, as in any collection, and Payload deletes none of them.

In two cases a delete still deletes the documents right below, as Payload does:

- The collection had documents with parents before you added the plugin, and `backfillPaths` hasn't run since. Run it [once](/path/installation/#documents-you-already-have) before anything in the collection is deleted.
- The collection is also given with `parent: false`, so the plugin lifts nothing in it.

## Trash

In a collection with Payload's `trash: true`, a deleted document goes to the trash first, and the documents below it stay where they are:

- A document in the trash takes no path, so another document can take it, and `findByPath` doesn't find it. It keeps the path it stores.
- Taking it out of the trash is refused when another document took a path it stores since then, as published or as a draft. It then stays in the trash:
  > Page "New report" is already at /report, so change the slug or the parent.
- Deleting it for good lifts the documents below it, as any delete does.
