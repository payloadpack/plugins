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
  onPathsChanged: ({ changedPaths, payload, req }) => {
    // Purge your cache here.
  }
})
```

| Key                | What it sets                                                                                                                                                                      | Default                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `collections`      | The [collections](#collections) whose documents get a path, each by its slug or as `{ slug, basePath, parent, localized, slugField, parentField }`                                |                                               |
| `rootSlug`         | The slug that makes a top-level document the [home page](#home-page)                                                                                                              | `home`                                        |
| `reservedSegments` | [Segments your site serves itself](#reserved-slugs), as a list or each with why                                                                                                   | Payload's admin and API routes                |
| `slugify`          | What makes [a slug](/path/paths/#the-slug) from a title, from what an editor typed and for the slug field's button, as the `slugify` of Payload's own slug field. It may be async | Accents off Latin letters, other scripts kept |
| `onPathsChanged`   | A function that [hears which paths changed](/path/api/on-paths-changed/)                                                                                                          | none                                          |
| `sql`              | On Postgres and SQLite, the `sql` your database adapter exports, as in [Installation](/path/installation/#add-the-plugin)                                                         | none, which fits MongoDB                      |

## Collections

List a collection by its slug, or as an object when it needs more than that:

```ts title="payload.config.ts"
pathPlugin({
  collections: [
    { slug: 'pages', localized: true },
    { slug: 'posts', basePath: '/blog', parent: false },
    { slug: 'topics', basePath: '/topics' }
  ]
})
```

| Key           | What it sets                                                                                                               | Default                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `slug`        | The collection                                                                                                             |                                                 |
| `basePath`    | What the paths of its top-level documents start with, such as `/blog`                                                      | None, so they start at the root                 |
| `parent`      | `false` when its documents have no parent                                                                                  | Its documents have a parent                     |
| `localized`   | `true` when its documents have [a path per locale](#a-path-per-locale)                                                     | One slug and one path, the same in every locale |
| `slugField`   | [Field options](#field-options) for the slug field: `access`, `admin`, `hooks`, `label` and `validate`                     | The plugin's own                                |
| `parentField` | [Field options](#field-options) for the plugin's own parent field: `access`, `admin`, `filterOptions`, `hooks` and `label` | The plugin's own                                |

With `basePath: '/blog'` a top-level post is at `/blog/my-post`. Leave it out and the collection's top-level documents sit at the root, like pages. A base path is no document of its own, so a page may sit at `/blog` beside the posts.

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

- Give `hierarchy` as `true`, or as an object with `parentFieldName`. In Payload 4.0.0-beta.10 an object without it breaks every delete in the collection, with or without the plugin.
- A [delete](/path/moves-and-deletes/#deletes) lifts the documents right below one level, as in any collection. On its own, Payload deletes them.
- Where the collection already has documents with parents, run [`backfillPaths`](/path/api/backfill-paths/) once after you add the plugin, before anything in the collection is deleted. Until then a delete also deletes the documents right below, as Payload does on its own.
- Payload's hierarchy has no parent field in the form, so a refused parent, such as a document below itself, shows on the slug field.
- With `parent: false` as well, the collection keeps Payload's tree in the admin and gets paths without a parent in them. The plugin lifts nothing there, so a delete deletes the documents right below, as Payload does.

### A path per locale

A collection's documents have one slug and one path, the same in every locale, also when your Payload config has localization. With `localized: true`, they have a slug and a path per locale, so a page can be at `/about` in English and at `/om-oss` in Swedish.

`true` is the only value `localized` takes, and it goes together with `basePath`, `parent: false` and Payload's hierarchy. In a site without localization it changes nothing. See [Languages](/path/languages/) for how each locale gets its path, and what to do in a collection that already has documents.

### Field options

`slugField` and `parentField` set Payload's own field options on the slug field and the parent field the plugin adds. In a site where only the default locale may change a slug, give the slug field Payload's field access:

```ts title="payload.config.ts"
pathPlugin({
  collections: [
    {
      slug: 'pages',
      slugField: { access: { update: ({ req }) => req.locale === 'en' } }
    }
  ]
})
```

In another locale the admin then shows the slug read-only, without its lock and refresh buttons. A save there that sends another slug keeps the slug and the path the page has, and saves the rest of the page.

- `access`, `label` and `validate` are used as you give them.
- `admin` goes over the plugin's own, and so do its `components`, so the slug field keeps its lock and its place in the sidebar unless you set your own.
- Your `hooks` run after the plugin's own, so a `beforeValidate` hook on the slug gets it cleaned.
- Your `filterOptions` on the parent holds together with the plugin's own, so the picker still leaves out the document itself and the home page. It takes what Payload's own `filterOptions` takes.
- `parentField` is only for a collection with the plugin's own parent, so not for one with `parent: false` or Payload's hierarchy.

## Home page

```ts title="payload.config.ts"
pathPlugin({ collections: ['pages', 'posts'], rootSlug: 'start' })
```

- The top-level document with this slug is the home page, and its path is `/`. Without `rootSlug`, the slug is `home`.
- Only a top-level document in a collection without a base path can be it. A page below another page with the slug `start` sits at `/about/start`, and with posts at `/blog`, a post with it sits at `/blog/start`.
- The home page holds no documents, since their paths would start with `/start/`, which the home page doesn't answer.
- In a collection with a path per locale it is checked per locale, so a page is the home page in the locales where its slug is the root slug.

## Reserved slugs

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  reservedSegments: {
    root: { admin: 'the CMS', api: "the CMS's API" },
    anyDepth: { '-': 'starts the page and filters of a listing' }
  }
})
```

- A segment in `root` is refused as a path's first segment, base path included. Below a parent it is free, so `/docs/api` is fine.
- A segment in `anyDepth` is refused anywhere in a path, such as the `-` in `/journal/-/page/2`.
- Without `root`, the plugin reserves the first segment of Payload's `routes.admin` and `routes.api`. A `root` you give is the whole list, so name those two in it, as above.
- Each also takes a list, such as `root: ['admin', 'api', 'shop']`, and the [refusal](/path/refusals/#reserved-slugs) then gives no reason.
- A move or a delete that would put a document on a reserved slug is refused too, and `findByPath` answers a path with one with `null`, without asking the database.

## Slugify

```ts title="payload.config.ts"
import { defaultSlugify, pathPlugin } from '@payloadpack/path'

pathPlugin({
  collections: ['pages', 'posts'],
  // toLatin is yours.
  slugify: (args) => defaultSlugify({ ...args, valueToSlugify: toLatin(args.valueToSlugify) })
})
```

`defaultSlugify` is what the plugin uses without a `slugify` of your own, so a rule of yours can run before or after it, as above.

## The fields it adds

Each collection in `collections` gets these fields, after its own:

| Field       | What it holds                                                                                                                                                         | Which collections get it                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `parent`    | The parent, a relationship to the document's own collection. Its picker leaves out the document itself and the home page                                              | One with the plugin's own parent                                 |
| `slug`      | The document's own segment of the path, shown as Payload's own slug field, with its lock                                                                              | Every one                                                        |
| `path`      | The stored path, read-only and indexed                                                                                                                                | Every one                                                        |
| `ancestors` | The ids of the documents above, top-down, an indexed relationship to the document's own collection. The API returns it and filters by it, and the admin leaves it out | One whose documents have a parent, the plugin's own or Payload's |

In a collection given with `localized: true`, `slug` and `path` are localized fields.

## When the config is wrong

The plugin checks its options when Payload builds the config, and stops with one of these:

| Message                                                                                                                                                    | What to change                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| @payloadpack/path was given collections the config doesn't have: posts.                                                                                    | Fix the slug, or list the plugin after the plugin that adds the collection                  |
| @payloadpack/path was given pages more than once, so list each collection once.                                                                            | Keep one entry for the collection, with its base path if it has one                         |
| @payloadpack/path adds slug to pages, so remove its own.                                                                                                   | Remove or rename the collection's own field                                                 |
| @payloadpack/path needs the sql your database adapter exports on Postgres and SQLite, so import it next to the adapter and pass it to pathPlugin() as sql. | Add `sql` to the plugin's options, as in [Installation](/path/installation/#add-the-plugin) |
| @payloadpack/path adds no parent field to posts, so leave out its parentField.                                                                             | Remove `parentField`, which only the plugin's own parent field takes                        |
| @payloadpack/path was given the base path blog for posts, which doesn't start with a slash, so start it with one.                                          | Write it as `/blog`                                                                         |
| @payloadpack/path was given the base path /blog/ for posts, which ends with a slash, so remove that slash.                                                 | Write it as `/blog`                                                                         |
| @payloadpack/path was given the base path /blog//news for posts, which has an empty segment, so remove the extra slash.                                    | Write it as `/blog/news`                                                                    |
| @payloadpack/path was given the base path / for posts, which is the root already, so leave basePath out.                                                   | Remove `basePath`, or give it a segment such as `/blog`                                     |
