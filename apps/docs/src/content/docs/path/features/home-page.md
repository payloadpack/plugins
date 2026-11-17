---
title: Home page
description: The top-level document with the root slug answers /, and holds no other documents.
---

The top-level page whose slug is `home` is the home page, and its path is `/`. To use another slug, set `rootSlug`:

```ts title="payload.config.ts"
pathPlugin({ collections: ['pages', 'posts'], rootSlug: 'start' })
```

Only a top-level document can be the home page, in a collection without a [base path](/path/features/paths/#base-paths). A page below another page with the slug `home` sits at `/about/home`, and with posts at `/blog`, a post with the slug `home` sits at `/blog/home`.

`/` is a path like any other, so one document is at it. With neither pages nor posts given a base path, a top-level post with the root slug is refused while a page is the home page, whether that page is published or not.

## The home page holds no documents

The paths below it would start with `/home/`, which the home page doesn't answer, so editors can't put a document there:

> The home page can't hold pages, so pick another parent.

A page that holds documents can't become the home page either:

> The home page can't hold pages, so move the ones under this page first.

And a delete that would lift a child page with the root slug to the top level is refused:

> Page "Start home" would become the home page at /, so change its slug first.

The messages name your own collection, by its labels.

## With localization

The root slug is checked per locale. A page whose Swedish slug is `hem` is the home page in English and sits at `/hem` in Swedish.
