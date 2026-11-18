---
title: Refusals
description: Every message an editor can meet when the plugin stops a save, a move or a delete, and what it means.
---

A refusal comes before anything is written, and names what is in the way and what to change. It shows on the parent field when the parent is what's wrong, and on the slug otherwise, or always on the slug in a collection with Payload's hierarchy. The messages name your own collections by their labels.

## Slug and parent

| Message                                                    | When                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Give this document a slug, or a title to make one from.    | A document with neither is published, or saved in a collection without drafts                               |
| The parent doesn't exist, so pick another one.             | The parent was deleted while the editor worked, or isn't a document of this collection                      |
| The parent has no path yet, so save the parent first.      | The parent is a draft without a slug, or was stored before the plugin was added and hasn't been saved since |
| A document can't sit below itself, so pick another parent. | The parent is the document itself, or a document below it                                                   |

## Taken paths

| Message                                                                   | When                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Page "Plan A" is already at this path, so change the slug or the parent.  | Another document, in any collection and of any status, is at the path                   |
| Post "Press" is already at /press, so change the slug or the parent.      | A move or a delete would put a document below at a path that is taken                   |
| Page "Shop" is already at /butik in sv, so change the slug or the parent. | A locale that falls back to the slug the editor just changed would land on a taken path |

## Reserved slugs

| Message                                                                                    | When                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| The site serves the CMS at /admin, so pick another slug or a parent.                       | The first segment is in `root`, here with `admin: 'the CMS'` |
| The site serves the admin panel at /admin, so pick another slug or a parent.               | No `root` is given, so Payload's admin and API are reserved  |
| The site serves something else at /shop, so pick another slug or a parent.                 | The first segment is in `root` given as a list               |
| A path can't hold -, which starts the page and filters of a listing, so pick another slug. | A segment anywhere in the path is in `anyDepth`              |
| A path can't hold -, so pick another slug.                                                 | The segment is in `anyDepth` given as a list                 |

See [Reserved slugs](/path/configuration/#reserved-slugs) for how to set them.

## Home page

| Message                                                                      | When                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The home page can't hold pages, so pick another parent.                      | The parent is the home page                                        |
| The home page can't hold pages, so move the ones under this page first.      | A page with documents below it would become the home page          |
| Page "Start home" would become the home page at /, so change its slug first. | A delete would lift a document with the root slug to the top level |

## Bulk updates

A bulk update or delete handles each document on its own. A document the plugin refuses is listed in the operation's `errors`, and the others are saved or deleted.
