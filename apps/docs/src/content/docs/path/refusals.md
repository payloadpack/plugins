---
title: Refusals
description: Every message an editor can see when the plugin stops a save, a move or a delete, and what it means.
---

| What is wrong                                                       | Where the refusal shows |
| ------------------------------------------------------------------- | ----------------------- |
| The parent                                                          | The parent field        |
| Anything else, or anything in a collection with Payload's hierarchy | The slug field          |

- The plugin refuses before it writes anything. Each refusal says what is in the way and what to change.
- The messages use your collections' labels.

## Slug and parent

| Message                                                    | When                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Give this document a slug, or a title to make one from.    | The document has neither, and is published or saved in a collection without drafts     |
| The parent doesn't exist, so pick another one.             | The parent was deleted while the editor worked, or is not in this collection           |
| The parent has no path yet, so save the parent first.      | The parent is a draft without a slug, or has not been saved since you added the plugin |
| A document can't sit below itself, so pick another parent. | The parent is the document itself, or a document below it                              |

## Taken paths

| Message                                                                   | When                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Page "Plan A" is already at this path, so change the slug or the parent.  | Another document is at the path, in any collection and with any status |
| Post "Press" is already at /press, so change the slug or the parent.      | A move or a delete would put a document below at a taken path          |
| Page "Shop" is already at /butik in sv, so change the slug or the parent. | A locale that falls back to the changed slug would get a taken path    |

## Reserved slugs

| Message                                                                                    | When                                                           |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| The site serves the CMS at /admin, so pick another slug or a parent.                       | The first segment is in `root`, set here as `admin: 'the CMS'` |
| The site serves the admin panel at /admin, so pick another slug or a parent.               | No `root` is set, so Payload's admin and API are reserved      |
| The site serves something else at /shop, so pick another slug or a parent.                 | The first segment is in `root`, set as a list                  |
| A path can't hold -, which starts the page and filters of a listing, so pick another slug. | A segment anywhere in the path is in `anyDepth`                |
| A path can't hold -, so pick another slug.                                                 | The segment is in `anyDepth`, set as a list                    |

[Reserved slugs](/path/configuration/#reserved-slugs) shows how to set them.

## Home page

| Message                                                                      | When                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The home page can't hold pages, so pick another parent.                      | The parent is the home page                                        |
| The home page can't hold pages, so move the ones under this page first.      | A page with documents below it would become the home page          |
| Page "Start home" would become the home page at /, so change its slug first. | A delete would lift a document with the root slug to the top level |

## Bulk updates

A bulk update or delete handles each document on its own. A refused document is listed in the operation's `errors`, and the others are saved or deleted. See [Limits](/path/limits/#bulk-updates) for more.
