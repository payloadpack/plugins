---
title: Paths
description: A path is the parent's path, a slash and the slug, stored on the document.
---

A document's path is its parent's path, a slash and its slug. A top-level document, one without a parent, has the path of its collection's [base path](#base-paths), a slash and its slug, or sits at the root when the collection has none:

| Document           | Parent      | Slug          | Path                    |
| ------------------ | ----------- | ------------- | ----------------------- |
| Page "About"       | none        | `about`       | `/about`                |
| Page "Team"        | About       | `team`        | `/about/team`           |
| Post "Hello world" | none        | `hello-world` | `/hello-world`          |
| Post "Part two"    | Hello world | `part-two`    | `/hello-world/part-two` |

A document's parent is a document of its own collection, so pages sit below pages and posts below posts. The paths still share one site: a path belongs to one document, whichever collection it is in. See [One document per path](/path/features/taken-paths/).

The parent is held in the plugin's own `parent` field, or in Payload's hierarchy where the collection has it. A collection given with `parent: false` has no parents, so every document of it is top-level. See [Collections](/path/configuration/#collections) for which one fits.

The path is saved on the document and indexed, so a site reads it instead of building it. In a collection whose documents have a parent, the ids of the documents above sit in the `ancestors` field, top-down, which is how a move finds everything below a document at once. The admin leaves that field out, and the API returns it. Only the plugin writes the two: a value a save sends for them, from the API or an admin form left open during a move, is ignored.

Two documents may share a slug as long as their parents differ, so `/north/contact` and `/south/contact` live side by side.

## Base paths

A collection can start below a path of its own, such as posts below `/blog`, when your site wants its sections apart:

```ts title="payload.config.ts"
pathPlugin({ collections: ['pages', { slug: 'posts', basePath: '/blog' }] })
```

A top-level post is then at the base path, a slash and its slug, and the rest follows its parent as before:

| Document           | Parent      | Slug          | Path                         |
| ------------------ | ----------- | ------------- | ---------------------------- |
| Post "Hello world" | none        | `hello-world` | `/blog/hello-world`          |
| Post "Part two"    | Hello world | `part-two`    | `/blog/hello-world/part-two` |

With [`parent: false`](/path/configuration/#no-parent) as well, every post is top-level, so each one is at `/blog`, a slash and its slug.

A base path is optional and is no document of its own. A page at `/blog` can sit beside the posts, and a page below it is refused at a path a post is at, as any other path in use.

A base path starts with a slash, has no slash at the end and no empty segment, and isn't `/` alone. The plugin checks it at startup, with the messages on [Configuration](/path/configuration/#when-the-config-is-wrong). Reserved segments apply to the whole path, base path included.

## The slug

- A document without a slug takes one from its title, such as `opening-hours` from "Opening Hours".
- A slug is cleaned on every save, so `Summer Sale!` is saved as `summer-sale`. With a [`slugify`](/path/configuration/) of your own, that function cleans it.
- A Latin letter loses its accent and a letter of another script stays, so `Vår historia` becomes `var-historia` and `Новости` stays `новости`.
- A save that clears the slug keeps the one it had. Editing a title never moves a published URL.
- A typed slug with nothing left after cleaning, such as `!!!`, counts as no slug.

The field shows as Payload's own slug field: locked until the editor unlocks it, with a button that makes the slug from the title, in the locale the editor is in. A collection without a title field, `admin.useAsTitle`, has nothing to make a slug from, so there the button does nothing.

## What an editor can meet

| Message                                                    | When                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Give this document a slug, or a title to make one from.    | A document with neither is published, or saved in a collection without drafts                               |
| The parent doesn't exist, so pick another one.             | The parent was deleted while the editor worked, or isn't a document of this collection                      |
| The parent has no path yet, so save the parent first.      | The parent is a draft without a slug, or was stored before the plugin was added and hasn't been saved since |
| A document can't sit below itself, so pick another parent. | The parent is the document itself, or a document below it                                                   |

The messages show on the field they are about, the slug or the parent. A collection with [Payload's hierarchy](/path/configuration/#payloads-hierarchy) has no parent field in the form, so there they all show on the slug.
