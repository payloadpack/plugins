<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/payloadpack/plugins/main/.github/assets/icons/logo-light.svg">
    <img width="64" height="64" alt="" src="https://raw.githubusercontent.com/payloadpack/plugins/main/.github/assets/icons/logo-dark.svg">
  </picture>
</p>

<h1 align="center">@payloadpack/redirects</h1>

<p align="center">Redirects your editors manage in Payload 4.<br>Found through database indexes, so a lookup costs the same at 1,000 redirects as at 100,000.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@payloadpack/redirects"><img alt="npm version" src="https://img.shields.io/npm/v/@payloadpack/redirects"></a>
  <a href="https://github.com/payloadpack/plugins/actions/workflows/ci.yml"><img alt="Build status" src="https://github.com/payloadpack/plugins/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://payloadcms.com"><img alt="Payload version" src="https://img.shields.io/npm/dependency-version/@payloadpack/redirects/peer/payload"></a>
  <a href="https://github.com/payloadpack/plugins/blob/main/packages/redirects/LICENSE"><img alt="PolyForm Perimeter license" src="https://img.shields.io/badge/license-PolyForm%20Perimeter-blue"></a>
</p>

<p align="center">
  <a href="https://docs.payloadpack.com/redirects/"><b>Documentation</b></a> ·
  <a href="https://github.com/payloadpack/plugins/blob/main/packages/redirects/CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/payloadpack/plugins/blob/main/CONTRIBUTING.md">Contributing</a>
</p>

## What you get

- ↪️ **Exact paths and regexes:** editors send visitors from an exact path or a regex to a document on your site or a URL
- 📄 **Document targets follow moves:** a redirect to a document sends visitors wherever the document is now, even after later moves
- 🧭 **Move suggestions:** report page moves from your own hook or [`@payloadpack/path`](https://docs.payloadpack.com/path/) to create one suggestion per moved branch, which an editor answers right on the moved page
- 🔎 **Old URLs with a query string:** matches `/news.aspx?id=123` in any order and case, without comparing tracking parameters such as `utm_source`, which every destination keeps
- ⚡ **Constant lookup cost:** one indexed query reads only the redirects and regexes that can cover a path, so 100,000 cost the same as 1,000, plus one query when the winner targets a document
- 🛡️ **RE2 regexes and host-locked destinations:** regexes never backtrack, and destinations never leave their host whatever a visitor's path fills in

## Install

```sh
bun add @payloadpack/redirects
```

Add `redirectsPlugin` to `payload.config.ts` with the collections a redirect can send visitors to, `buildDocumentPath`, and `documentSelect`:

```ts
import { redirectsPlugin } from '@payloadpack/redirects'
import { buildConfig } from 'payload'

export default buildConfig({
  plugins: [
    redirectsPlugin({
      collections: ['pages'],
      buildDocumentPath: ({ document }) => `/${document.slug}`,
      documentSelect: { slug: true }
    })
  ]
})
```

With `@payloadpack/path`, return the path it stores: `buildDocumentPath: ({ document }) => document.path` with `documentSelect: { path: true }`.

Look up a redirect in your page route when no document holds the path:

```ts
import { findRedirect } from '@payloadpack/redirects'

const { foundRedirect } = await findRedirect({ path: '/old-page', payload })
// { destination: '/new-page', matchedQueryString: false, permanent: true, to: { type: 'document' } } or null
```

`permanent` is `true` for 308 and `false` for 307. Pass `hasDocument` to follow chains in one hop, and give visitors read access to published documents in the collections listed in `collections`.

See the [Installation guide](https://docs.payloadpack.com/redirects/installation/), [Match query strings in a proxy](https://docs.payloadpack.com/redirects/query-strings/), and [Let redirects win over pages](https://docs.payloadpack.com/redirects/win-over-pages/).

## Suggest redirects on page moves

To suggest a redirect when a page moves, call [`suggestRedirects`](https://docs.payloadpack.com/redirects/api/suggest-redirects/) with each document's old and new path. This example covers a collection without drafts:

```ts
import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'
import { suggestRedirects } from '@payloadpack/redirects'

// Your site's own way of building a page's path.
const buildPath = (page: { slug: string }) => `/${page.slug}`

const suggestRedirectOnMove: CollectionAfterChangeHook = async ({ doc, operation, previousDoc, req }) => {
  if (operation !== 'update') return doc
  await suggestRedirects({
    changedPaths: [{ collection: 'pages', id: doc.id, from: buildPath(previousDoc), to: buildPath(doc) }],
    payload: req.payload,
    req
  })
  return doc
}

export const Pages: CollectionConfig = {
  slug: 'pages',
  hooks: { afterChange: [suggestRedirectOnMove] },
  fields: [{ name: 'slug', type: 'text', required: true }]
}
```

With `@payloadpack/path`, pass `onPathsChanged: suggestRedirects` or call `await suggestRedirects(args)` inside your existing `onPathsChanged`. See [Suggest redirects when pages move](https://docs.payloadpack.com/redirects/suggest-on-move/).

## Configure

| Option               | Purpose                                                                                                                      | Default             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `collections`        | Collections a redirect can send visitors to a document of                                                                    | Required            |
| `buildDocumentPath`  | Builds the path of a document a redirect sends visitors to from the document                                                 | Required            |
| `documentSelect`     | Fields `buildDocumentPath` reads, so a lookup reads only those                                                               | Whole document      |
| `trackingParameters` | Extra query string parameters no redirect compares, beside `utm_source` and the other defaults                               | Built-in defaults   |
| `winOverDocuments`   | Lets redirects win over a page at their path: selected redirects (`'perRedirect'`) or every redirect that is On (`'always'`) | Omitted (page wins) |
| `overrides`          | Function that takes the Redirects collection and returns it changed                                                          | None                |

See [Configuration](https://docs.payloadpack.com/redirects/configuration/), [`findRedirect`](https://docs.payloadpack.com/redirects/api/find-redirect/), and [Refusals and errors](https://docs.payloadpack.com/redirects/refusals/).

## Speed

Without a proxy, your page route asks for a redirect only when no page holds the path, so normal page views pay nothing. With the [query-string proxy](https://docs.payloadpack.com/redirects/query-strings/), this is what it adds to each page view at 100,000 redirects, median (p95). See [Speed](https://docs.payloadpack.com/redirects/speed/) for how it is measured and how to run it yourself.

<!-- speed-table:start -->

|          | Without a query string | With one, database on the same machine | With one, database 5 ms away |
| -------- | ---------------------- | -------------------------------------- | ---------------------------- |
| MongoDB  | 0.06 ms (0.09 ms)      | 0.62 ms (0.86 ms)                      | 5.81 ms (6.25 ms)            |
| Postgres | 0.08 ms (0.13 ms)      | 0.55 ms (0.77 ms)                      | 5.78 ms (6.02 ms)            |
| SQLite   | 0.08 ms (0.1 ms)       | 0.34 ms (0.53 ms)                      | Same machine only            |

<!-- speed-table:end -->

With [`winOverDocuments`](https://docs.payloadpack.com/redirects/win-over-pages/), the proxy checks every page view instead and adds:

<!-- speed-table-win-over-documents:start -->

|          | Database on the same machine | Database 5 ms away |
| -------- | ---------------------------- | ------------------ |
| MongoDB  | 0.47 ms (0.81 ms)            | 5.77 ms (6.25 ms)  |
| Postgres | 0.55 ms (0.76 ms)            | 5.88 ms (6.81 ms)  |
| SQLite   | 0.36 ms (0.59 ms)            | Same machine only  |

<!-- speed-table-win-over-documents:end -->

## Requirements

Payload 4.0.0-beta.11 or later, with MongoDB, Postgres, or SQLite. `@payloadpack/path` 0.3.1 or later, if you use it.

## License

Use it in any project, including client work you charge for and products you sell. What you can't do is offer the plugin, or a copy or fork of it, to others as a competing plugin, paid or free. The terms are the [PolyForm Perimeter License 1.0.1](https://github.com/payloadpack/plugins/blob/main/packages/redirects/LICENSE).
