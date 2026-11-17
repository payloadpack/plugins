---
title: One document per path
description: Only one document is at a path, drafts too, across every collection the plugin is given.
---

A path shows one document, so only one document may be at it, whichever of your collections it is in and whatever its status. A page at `/plans` keeps a top-level post from taking `/plans` too, and with posts at the [base path](/path/features/paths/#base-paths) `/blog`, a post at `/blog/launch` keeps a page below the page `/blog` from taking `/blog/launch`. Only a document in the [trash](/path/features/deletes/#trash) takes no path.

An editor who picks a path in use is told which document is at it:

> Page "Plan A" is already at this path, so change the slug or the parent.

## Drafts

A draft takes its path too, so a new draft is refused at the path of another draft. A draft's new slug or parent on a published document is a pending move, which takes nothing until the document moves. Two pending moves may plan the same path, and the first one published gets it. The second one is refused when its editor publishes, with the message above naming the first.

A draft, or an autosave, is refused at a path another document is at, so an editor finds out while writing rather than at publish.

## Duplicates

A duplicate sits below the same parent as its original, so it takes the original's slug with `-copy`, such as `/about-copy`, or `-copy-2` and up when another document below that parent has that slug. In a collection given with [`parent: false`](/path/configuration/#no-parent), that is any other document of the collection. The editor renames it before publishing.

## A move that lands on a path in use

When a document moves, the documents below it move too, and one of them may land on a path a document of any collection is at. The move is refused and names that document and the path:

> Page "Yard chairs" is already at /yard/chairs, so change the slug or the parent.

A [delete](/path/features/deletes/) that lifts documents is checked the same way.

## In another language

With localization, a path is taken per locale. When a save moves a path in another locale than the one the editor works in, the message names the path and the locale:

> Page "Shop" is already at /butik in sv, so change the slug or the parent.

That happens when a locale without a slug of its own follows the slug the editor just changed. See [Languages](/path/features/localization/).

A document of a collection given with [`localized: false`](/path/features/localization/#a-collection-that-isnt-localized) takes its one path in every locale. A document of another collection that is at that path in any one locale is in the way of it, and the other way round.

## Two saves at the same moment

Each save checks the path before it writes, so two editors saving the same path in the same instant can both pass it, since neither save sees the other yet. It is rare on a site with a handful of editors. When it happens, both documents stay at the path and `findByPath` returns one of them, until an editor gives one of them another slug or parent.
