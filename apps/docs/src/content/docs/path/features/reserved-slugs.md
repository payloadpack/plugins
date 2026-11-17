---
title: Reserved slugs
description: Keep the paths your site serves itself, such as /admin and /api, out of editors' hands.
---

Your site serves some paths itself: Payload's admin at `/admin`, its API at `/api`, and maybe a listing's filters below any page. Without any config, the plugin reserves Payload's own two at the root. Tell it your own, with why, and editors can't put a document there:

```ts title="payload.config.ts"
pathPlugin({
  collections: ['pages', 'posts'],
  reservedSegments: {
    root: { admin: 'the CMS', api: "the CMS's API" },
    anyDepth: { '-': 'starts the page and filters of a listing' }
  }
})
```

## At the root

A segment in `root` is refused as the first segment of a path, the one at the root:

> The site serves the CMS at /admin, so pick another slug or a parent.

Below a parent it is free, so `/docs/api` is fine.

Without `root`, the plugin reserves the first segment of Payload's `routes.admin` and `routes.api`, so `admin` and `api` unless you changed them:

> The site serves the admin panel at /admin, so pick another slug or a parent.

> The site serves the API at /api, so pick another slug or a parent.

A `root` you give is the whole list, an empty one too, so name those two in it to keep them reserved, as the example above does.

A [base path](/path/features/paths/#base-paths) is part of every path in its collection, so it is checked too. A collection with the base path `/api` would have every document refused.

## At any depth

A segment in `anyDepth` is refused anywhere in a path, such as a `-` that starts the page and filters of a listing, as in `/journal/-/page/2`:

> A path can't hold -, which starts the page and filters of a listing, so pick another slug.

Nothing is reserved at any depth unless you list it.

## Without a reason

`root` and `anyDepth` each take a list of segments instead, such as `root: ['admin', 'api', 'shop']` or `anyDepth: ['-']`. A segment from a list is refused without a reason:

> The site serves something else at /shop, so pick another slug or a parent.

> A path can't hold -, so pick another slug.

## Deletes and moves

A delete that would lift a document onto a reserved segment is refused with the same message, and so is a move.

## Lookups

`findByPath` answers a path with a reserved segment with `null`, without asking the database, so `/admin/collections/pages` costs your site nothing.
