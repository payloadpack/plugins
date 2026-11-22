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

## Compared with Payload's redirects plugin

Payload's own [`@payloadcms/plugin-redirects`](https://github.com/payloadcms/payload/tree/v4.0.0-beta.11/packages/plugin-redirects) only stores the list of redirects. On its own it sends no visitor anywhere: your site needs code that finds the redirect and sends the visitor on. Payload's [example website](https://github.com/payloadcms/payload/tree/v4.0.0-beta.11/templates/website), its Website Template, ships that code, so it's Payload's side below.

Finding one redirect, median (p95), with each database on the same machine as the app, so neither side waits on a network. The example website's lookup reads every redirect, and a list this long is too big for Next.js's data cache, so every lookup reads all of them from the database. Next.js still caches each rendered page, so the lookup runs whenever a page or post renders, pages that exist included: at build, on a path's first visit, each time Next.js renders it again, such as after any redirect is saved, and on every request in draft mode.

<!-- speed-table-comparison:start -->

| Finding one redirect among 100,000 | @payloadpack/redirects | Payload's example website | Times faster | Example website, list cached |
| ---------------------------------- | ---------------------- | ------------------------- | ------------ | ---------------------------- |
| MongoDB                            | 0.19 ms (0.3 ms)       | 1.3 s (1.4 s)             | 6,400×       | 33.1 ms (34 ms)              |
| Postgres                           | 0.36 ms (0.43 ms)      | 1.3 s (1.3 s)             | 3,400×       | 32.4 ms (33.2 ms)            |
| SQLite                             | 0.2 ms (0.26 ms)       | 1.5 s (1.6 s)             | 7,200×       | 32.7 ms (34.2 ms)            |

<!-- speed-table-comparison:end -->

With a custom cache handler, which Next.js doesn't hold to 2 MB, the example website's lookup parses the cached list instead and costs at least the last column. At 1,000 redirects, where Next.js's data cache holds the list, it makes no database query: close to ours on the same machine, and faster than ours once the database is a round trip away. With the database elsewhere, ours and the uncached read each wait at least one round trip more, and the uncached read pulls the whole list across it. The plugin indexes `from`, so a lookup you write yourself can find an exact path in one query, though only in its exact spelling, without regexes, and with a query string only exactly as stored.

|                                                                                                        | @payloadpack/redirects                                                                                     | Payload's plugin with Payload's example website                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sends visitors to their redirect**                                                                   | ✅ The lookup is built in. Your page route calls `findRedirect` and sends the visitor on, about ten lines. | ❌ Not on its own: the plugin only stores the list. Your site needs code that finds the redirect and sends the visitor. Payload's example website ships about 90 lines of it, in four files. |
| **Ignores capital letters**<br>`/About-Us` finds the redirect from `/about-us`                         | ✅ Any spelling finds it.                                                                                  | ❌ Only the exact spelling.                                                                                                                                                                  |
| **Redirects from URLs at any depth**<br>`/blog/2019/05/opening-hours`                                  | ✅ Any URL your site gets, up to 32 levels deep.                                                           | ❌ Only `/slug` and `/posts/slug`. No route looks up a redirect for a deeper URL.                                                                                                            |
| **Redirects a whole section and keeps the rest of the URL**<br>`/blog/(.*)` → `/news/$1`               | ✅ One regex redirect. Its groups fill into the new URL as `$1` to `$9`.                                   | ❌ No regexes, and `/blog/…` is deeper than `/slug`, so editors can't redirect it.                                                                                                           |
| **Tells old URLs apart by what follows the ?**<br>`/news.aspx?id=123` and `?id=124` to different pages | ✅ Yes, with the query-string proxy, and with the parameters in any order and case.                        | ❌ No. Both go wherever `/news.aspx` goes.                                                                                                                                                   |
| **Keeps campaign tags on the way**<br>`?utm_source=newsletter`                                         | ✅ Kept on the new URL, with the query-string proxy.                                                       | ❌ Dropped.                                                                                                                                                                                  |
| **Suggests a redirect when a page moves**                                                              | ✅ Your site reports the move, and an editor turns the suggestion on with one click.                       | ❌ Nothing. Someone has to notice the old URL and add a redirect by hand.                                                                                                                    |
| **Redirects to pages at any depth**<br>`/about/team/people`                                            | ✅ Any page's path, nested or not, in every collection you list, and it follows the page when it moves.    | ❌ A picked page goes to `/slug` and a post to `/posts/slug`. Any other path must be typed as a URL, which doesn't follow the page when it moves.                                            |
| **Permanent or temporary, as editors pick**                                                            | ✅ Visitors get what the editor picked: permanent (308) or temporary (307).                                | ❌ The plugin can store one of five status codes editors pick. Payload's example website doesn't turn it on and always sends temporary.                                                      |
| **Turns a redirect off without deleting it**                                                           | ✅ Set it to Off.                                                                                          | ❌ Delete it.                                                                                                                                                                                |
| **Catches mistakes when you save**<br>a `mailto:` link to redirect from                                | ✅ Cleans each one and refuses what can't work.                                                            | ❌ Only checks that the fields are filled in and no old URL is used twice.                                                                                                                   |

[Speed](https://docs.payloadpack.com/redirects/speed/#compared-with-payloads-redirects-plugin) shows 1,000 and 10,000 redirects, the exact code each side runs, and how to run the benchmark yourself from this repository.

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

With `@payloadpack/path`, pass `onPathsChanged: suggestRedirects` or call `await suggestRedirects(args)` inside your existing `onPathsChanged`. See [Suggest redirects on a move](https://docs.payloadpack.com/redirects/suggest-on-move/).

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
