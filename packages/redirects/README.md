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

- ↪️ **Redirects editors manage**: from an exact path or a regex, to a page or a URL
- 📄 **A page target that follows the page** wherever it moves later
- 🧭 **A suggested redirect from every old path**, with [`@payloadpack/path`](https://docs.payloadpack.com/path/): one per moved branch, however large, which the editor says yes or no to right on the moved page
- 🔎 **Old URLs with a query string**, such as `/news.aspx?id=123`, matched in any order and case, without tracking parameters such as `utm_source`, which every destination keeps
- ⚡ **One indexed query per lookup** that reads only the redirects and regexes able to cover the path, so 100,000 cost what 1,000 do, plus one when the redirect it finds sends visitors to a page
- 🛡️ **Regexes on RE2**, so no regex can hang a lookup, and a target that never leaves your site

## Install

```sh
bun add @payloadpack/redirects
```

Name the collections a redirect can send visitors to, and how your site builds the path of one of their documents. With `@payloadpack/path`, that is the path it keeps, and `documentSelect` has a lookup read only that field. If you want a move to suggest a redirect from the old path, pass `suggestRedirects` to `onPathsChanged`. Leave it out and moves suggest nothing:

```ts
import { pathPlugin } from '@payloadpack/path'
import { redirectsPlugin, suggestRedirects } from '@payloadpack/redirects'

export default buildConfig({
  plugins: [
    pathPlugin({ collections: ['pages', 'posts'], onPathsChanged: suggestRedirects }),
    redirectsPlugin({
      collections: ['pages', 'posts'],
      buildDocumentPath: ({ document }) => document.path,
      documentSelect: { path: true }
    })
  ]
})
```

Without it, build the path from the document your own way:

```ts
redirectsPlugin({
  collections: ['pages'],
  buildDocumentPath: ({ document }) => `/${document.slug}`,
  documentSelect: { slug: true }
})
```

Then your site's page route, the catch-all route that renders its pages, asks for a redirect when no document holds the path:

```ts
import { findRedirect } from '@payloadpack/redirects'

const { foundRedirect } = await findRedirect({ path: '/old-page', payload })
// foundRedirect: { destination: '/new-page', matchedQueryString: false, permanent: true, to: { type: 'document' } }, or null
```

`permanent` is a 308 and the rest a 307. Pass `hasDocument` to follow a chain of redirects in one hop. A lookup reads as a visitor, so give the collections it sends visitors to read access to their published documents. For redirects from a query string, a Next.js proxy passes `searchParams` too; the [docs](https://docs.payloadpack.com/redirects/installation/#query-strings-in-a-proxy) have it. To let redirects win over pages, set `winOverDocuments`, and the proxy answers every redirect instead, as the [docs](https://docs.payloadpack.com/redirects/installation/#letting-redirects-win-over-pages) show.

## Configure

| Key                  | What it sets                                                                                                             | Default              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `collections`        | The collections a redirect can send visitors to a document of                                                            | Required             |
| `buildDocumentPath`  | Builds the path of a document a redirect sends visitors to from the document                                             | Required             |
| `documentSelect`     | The fields `buildDocumentPath` reads, so a lookup reads only those                                                       | The whole document   |
| `trackingParameters` | Query string parameters no redirect compares, beside `utm_source` and the other defaults                                 | none                 |
| `winOverDocuments`   | Lets redirects win over a page at their path: the ones editors pick, with `'perRedirect'`, or every one, with `'always'` | none, so a page wins |
| `overrides`          | A function that changes the redirects collection, such as to add hooks of your own                                       | none                 |

Every option, every message an editor can meet and how to write a regex are in the [docs](https://docs.payloadpack.com/redirects/).

## Speed

Your page route asks for a redirect only when no page holds the path, so a page view pays nothing for it. If you add the Next.js proxy for old URLs with a query string, this is what it adds to each page view at 100,000 redirects, median (p95). The [docs](https://docs.payloadpack.com/redirects/speed/) have how it was measured and how to run it yourself.

<!-- speed-table:start -->

|          | Without a query string | With one, database on the same machine | With one, database 5 ms away |
| -------- | ---------------------- | -------------------------------------- | ---------------------------- |
| MongoDB  | 0.06 ms (0.09 ms)      | 0.62 ms (0.86 ms)                      | 5.81 ms (6.25 ms)            |
| Postgres | 0.08 ms (0.13 ms)      | 0.55 ms (0.77 ms)                      | 5.78 ms (6.02 ms)            |
| SQLite   | 0.08 ms (0.1 ms)       | 0.34 ms (0.53 ms)                      | Same machine only            |

<!-- speed-table:end -->

With `winOverDocuments`, the proxy checks every page view instead, and adds this to each one:

<!-- speed-table-win-over-documents:start -->

|          | Database on the same machine | Database 5 ms away |
| -------- | ---------------------------- | ------------------ |
| MongoDB  | 0.47 ms (0.81 ms)            | 5.77 ms (6.25 ms)  |
| Postgres | 0.55 ms (0.76 ms)            | 5.88 ms (6.81 ms)  |
| SQLite   | 0.36 ms (0.59 ms)            | Same machine only  |

<!-- speed-table-win-over-documents:end -->

## Requirements

Payload 4.0.0-beta.11 or later, with MongoDB, Postgres or SQLite. `@payloadpack/path` 0.3.1 or later, if you use it.

## License

Use it in any project, including client work you charge for and products you sell. What you can't do is offer the plugin, or a copy or fork of it, to others as a competing plugin, paid or free. The terms are the [PolyForm Perimeter License 1.0.1](https://github.com/payloadpack/plugins/blob/main/packages/redirects/LICENSE).
