---
title: Configuration
description: One key is required, the collections. A collection may have a base path or go without a parent, and the rest is optional.
---

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', { slug: 'posts', basePath: '/blog', parent: false }],
  rootSlug: 'home',
  reservedSegments: {
    root: { admin: 'the CMS', api: "the CMS's API" },
    anyDepth: { '-': 'starts the page and filters of a listing' }
  },
  // makeSlug is yours.
  slugify: ({ valueToSlugify }) => makeSlug(valueToSlugify),
  maxDocumentsPerMove: 1_000,
  onPathsChanged: ({ paths, moved }, req) => {
    // Purge your cache here.
  }
})
```

| Key                   | What it sets                                                                                                                                                                               | Default                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `collections`         | The [collections](#collections) whose documents get a path, each by its slug or as `{ slug, basePath, parent, localized }`                                                                 |                                               |
| `rootSlug`            | The slug that makes a top-level document the [home page](/path/features/home-page/)                                                                                                        | `home`                                        |
| `reservedSegments`    | [Segments your site serves itself](/path/features/reserved-slugs/), as a list or each with why                                                                                             | Payload's admin and API routes                |
| `slugify`             | What makes [a slug](/path/features/paths/#the-slug) from a title, from what an editor typed and for the slug field's button, as the `slugify` of Payload's own slug field. It may be async | Accents off Latin letters, other scripts kept |
| `maxDocumentsPerMove` | The most documents [one move](/path/features/moves/) or delete may carry                                                                                                                   | `1000`                                        |
| `onPathsChanged`      | A function that [hears which paths changed](/path/features/paths-changed/)                                                                                                                 | none                                          |

## Collections

List a collection by its slug, or as an object when it needs more than that:

```ts title="payload.config.ts"
pathPlugin({
  collections: [
    'pages',
    { slug: 'posts', basePath: '/blog', parent: false },
    { slug: 'topics', basePath: '/topics', localized: false }
  ]
})
```

| Key         | What it sets                                                                          | Default                                         |
| ----------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `slug`      | The collection                                                                        |                                                 |
| `basePath`  | What the paths of its top-level documents start with, such as `/blog`                 | None, so they start at the root                 |
| `parent`    | `false` when its documents have no parent                                             | Its documents have a parent                     |
| `localized` | `false` when its documents have [one path in every locale](#one-path-in-every-locale) | With localization, a slug and a path per locale |

With `basePath: '/blog'` a top-level post is at `/blog/my-post`. Leave it out and the collection's top-level documents sit at the root, like pages. See [Paths](/path/features/paths/#base-paths).

A parent is always a document of the same collection: a page sits below a page and a topic below a topic, and a post below a page isn't supported. A path still belongs to one document across all your collections.

Each collection gets its parent in one of three ways. In the example above, pages have the plugin's own parent, posts have none, and topics have Payload's hierarchy, which the topics collection has in its own config.

| Way                                                | What you write                             | When it fits                                                           |
| -------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| [The plugin's own parent](#the-plugins-own-parent) | The collection, with nothing more          | An editor picks the parent in the document's sidebar                   |
| [No parent](#no-parent)                            | `parent: false`                            | No document sits below another, as with posts below `/blog`            |
| [Payload's hierarchy](#payloads-hierarchy)         | `hierarchy` in the collection's own config | You want Payload's tree in the admin, or the collection has it already |

### The plugin's own parent

This is the default, for a collection listed as `'pages'` or as an object without `parent`. The collection gets a `parent` field in the sidebar, where an editor picks a document of the same collection.

### No parent

With `parent: false`, every document of the collection is top-level, so its path is the base path, a slash and its slug, such as `/blog/hello-world`. The collection gets no `parent` field. Nothing sits below anything, so a rename moves that one document and a delete lifts nothing.

`false` is the only value `parent` takes. Leave the key out for a collection whose documents have a parent.

### Payload's hierarchy

A collection whose own config has Payload's `hierarchy`, or its `folders` or `tags` preset, keeps Payload's parent. The plugin adds no `parent` field of its own and reads the parent from Payload's, the one `hierarchy.parentFieldName` names, which is `_h_topics` for topics by default. Nothing is set in the plugin for it:

```ts title="payload.config.ts"
export default buildConfig({
  collections: [{ slug: 'topics', hierarchy: true, fields: [{ name: 'title', type: 'text' }] }],
  plugins: [pathPlugin({ collections: [{ slug: 'topics', basePath: '/topics' }] })]
})
```

Your site gets Payload's tree in the admin, and an editor moves a document with the button in the document's header. The rest works as with the plugin's own parent: a move takes the branch along, and drafts, languages, taken paths, `backfillPaths` and `onPathsChanged` are the same.

A few things are good to know before you start:

- Give `hierarchy` as `true`, or as an object with `parentFieldName`. In Payload 4.0.0-beta.9 an object without it breaks every delete in the collection, with or without the plugin.
- A [delete](/path/features/deletes/#with-payloads-hierarchy) lifts the documents right below one level, as in any collection. On its own, Payload deletes them.
- Where the collection already has documents with parents, run [`backfillPaths`](/path/installation/#documents-you-already-have) once after you add the plugin, before anything in the collection is deleted. Until then a delete also deletes the documents right below, as Payload does on its own.
- Payload's hierarchy has no parent field in the form, so a refused parent, such as a document below itself, shows on the slug field.
- With `parent: false` as well, the collection keeps Payload's tree in the admin and gets paths without a parent in them. The plugin lifts nothing there, so a delete deletes the documents right below, as Payload does.

### One path in every locale

With localization in your Payload config, a collection's documents have a slug and a path per locale. With `localized: false`, they have one slug and one path, the same in every locale. It fits a collection whose documents should be at the same path in every language.

`false` is the only value `localized` takes, and it goes together with `basePath`, `parent: false` and Payload's hierarchy. In a site without localization it changes nothing. See [Languages](/path/features/localization/#a-collection-that-isnt-localized) for what it means for publishing and taken paths, and what to do in a collection that already has documents.

## The fields it adds

Each collection in `collections` gets these fields, after its own:

| Field       | What it holds                                                                                                                                                         | Which collections get it                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `parent`    | The parent, a relationship to the document's own collection. Its picker leaves out the document itself and the home page                                              | One with the plugin's own parent                                 |
| `slug`      | The document's own segment of the path, shown as Payload's own slug field, with its lock                                                                              | Every one                                                        |
| `path`      | The stored path, read-only and indexed                                                                                                                                | Every one                                                        |
| `ancestors` | The ids of the documents above, top-down, an indexed relationship to the document's own collection. The API returns it and filters by it, and the admin leaves it out | One whose documents have a parent, the plugin's own or Payload's |

With localization, `slug` and `path` are localized fields, except in a collection given with `localized: false`.

## When the config is wrong

The plugin checks its options when Payload builds the config, and stops with one of these:

| Message                                                                                                                 | What to change                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| @payloadpack/path was given collections the config doesn't have: posts.                                                 | Fix the slug, or list the plugin after the plugin that adds the collection |
| @payloadpack/path was given pages more than once, so list each collection once.                                         | Keep one entry for the collection, with its base path if it has one        |
| @payloadpack/path adds slug to pages, so remove its own.                                                                | Remove or rename the collection's own field                                |
| @payloadpack/path was given the base path blog for posts, which doesn't start with a slash, so start it with one.       | Write it as `/blog`                                                        |
| @payloadpack/path was given the base path /blog/ for posts, which ends with a slash, so remove that slash.              | Write it as `/blog`                                                        |
| @payloadpack/path was given the base path /blog//news for posts, which has an empty segment, so remove the extra slash. | Write it as `/blog/news`                                                   |
| @payloadpack/path was given the base path / for posts, which is the root already, so leave basePath out.                | Remove `basePath`, or give it a segment such as `/blog`                    |
