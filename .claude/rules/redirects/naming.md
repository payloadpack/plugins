---
paths:
  - 'packages/redirects/**'
  - 'apps/redirects-demo/**'
  - 'apps/docs/src/content/docs/redirects/**'
  - 'apps/docs/src/components/redirects/**'
  - 'apps/docs/src/data/redirects-*'
---

# Redirects naming

The terms for a plugin that gives Payload a collection of redirects editors manage, which a site looks up when no document holds a path, or on every page view when redirects win over documents.

## Language

**Redirect**:
A document of the Redirects collection: where visitors go who ask for a path it covers. By default a site asks for one only when no document holds the path, but for one from a path and a query string, which wins over the document at the path; with `winOverDocuments`, a redirect can win over a document too.
_Avoid_: rule, route, alias, forward

**From**:
What a redirect answers: the path visitors ask for, with a query string for Exact path, or a regex. A path is stored lowercased, with what a URL reads as something else, such as `?`, kept encoded, and matches in any case; a regex is stored and matched as written. Code and config say `from`.
_Avoid_: source, origin, old URL for what is stored

**Match**:
How a redirect's from covers a path. The admin says Exact path and Regex, and Path and subpaths, which only a suggestion has and the admin offers only on a redirect that has it; code says `exact`, `regex` and `below`, the match a move suggests, `SUGGESTED_MATCH`.
_Avoid_: mode, prefix, wildcard, and type, which is permanent or temporary

**Covers**:
Said of a redirect and a path it answers: Exact path covers its own path, Path and subpaths its path and every path below it, and a regex the paths its whole expression matches.
_Avoid_: hits, applies to

**Regex**:
A regular expression the whole path is matched against, run on RE2. Its groups go into a URL as `$1` to `$9`. Code says `regex` too.
_Avoid_: pattern, regular expression, wildcard, glob

**Fixed start**:
What every path a regex matches starts with, cut at its last slash: `/news` for `/news/(.*)`, and `/` for a regex without one. Stored, indexed and hidden as `regexPath`, so a lookup reads only the regexes at or above a path.
_Avoid_: prefix, anchor, base path, which is path's

**Query string**:
What follows `?` in a URL. A From of Exact path can hold one, such as `/news.aspx?id=123`, stored lowercased and decoded, its parameters sorted by name and then value, without tracking parameters, and a visitor's is compared the same way. A site passes the visitor's to `findRedirect` as `searchParams`, typed `SearchParams`. A found redirect that matched one says `matchedQueryString`.
_Avoid_: query, for the lookup; params, search for the string

**Tracking parameter**:
A query string parameter that says where a visitor came from, such as `utm_source` or `gclid`, which no redirect compares and every destination keeps. A site adds its own with `trackingParameters`.
_Avoid_: UTM, marketing parameter, ignored parameter

**Target**:
What an editor picks a redirect sends visitors to: a document on this site or a URL. Code says `to`, with `to.type` `document` or `url`.
_Avoid_: destination, for what an editor sets

**Destination**:
Where a found redirect sends a visitor, as a `Location` header carries it: a document's path now, a URL with its groups filled in, and the rest of the path below for Path and subpaths, lowercased to a document, with the visitor's query string but for the parameters the redirect matched. A found redirect says which its destination is in `to.type`.
_Avoid_: location, target, for the answer

**Sends nobody**:
Said of a redirect whose target gives no destination: a document visitors can't read, in the trash or gone, or a URL its groups would take off its own site. The next redirect that covers the path answers instead.
_Avoid_: broken, dead, invalid

**Permanent** and **temporary**:
What a redirect answers with, 308 or 307. Code says `type`, and `permanent` on a found redirect.
_Avoid_: 301 and 302, and status, which is On, Off or Suggested

**Status**:
Whether a redirect answers: **On**; **Off**, which answers as if the redirect weren't there; or **Suggested**, which a move saved and which answers nobody until someone says yes. Code says `status`, with `on`, `off` and `suggested`, and the admin offers Suggested only on a redirect that already is one.
_Avoid_: enabled, switched on, active, published, disabled, pending, draft

**Wins over a document**:
Said of a redirect that answers even where a document holds the path asked for. One that matched the visitor's query string always does; with `winOverDocuments: 'always'`, every redirect that is On does; and with `winOverDocuments: 'perRedirect'`, one an editor picked with its box, `winsOverDocument`, which the admin labels Wins over a page, does. The docs and the admin say page.
_Avoid_: beats, takes precedence, forced, priority, and switch or switched for the box, whose state is checked or unchecked

**Order**:
The editors' order of the list, kept by Payload's orderable in `_order`, which is the order regexes are tried in. Editors change it by dragging.
_Avoid_: priority, rank, weight

**Lookup**:
One question to the database for the redirects that can cover a path: the redirects from the path and its query string, from the path and every path above it, and the regexes whose fixed start is one of those paths. `findRedirect` asks one, and one more for each step of a chain, and reads the document target of only the redirect that wins.
_Avoid_: resolve, query for the whole of `findRedirect`

**Result**:
What `findRedirect` resolves to, typed `FindRedirectResult`: an object whose `foundRedirect` is the redirect that answers, or null, so a later field can join it without breaking a site.
_Avoid_: response, return value, the redirect itself, for the object

**Candidate**:
A redirect a lookup returns, which may cover the path.
_Avoid_: hit, match, for a returned document

**Chain**:
Redirects that each send a visitor to a path another redirect answers: by default a path no document holds, and with `winOverDocuments` any path on the site. `findRedirect` follows it to the end in one hop: by default only with `hasDocument`, with `'perRedirect'` asking `hasDocument` where it needs to, and with `'always'` without it.
_Avoid_: hops, redirect loop, for one that ends

**Circle**:
A chain that comes back to a path it met with the same query string, which answers no redirect. With `winOverDocuments`, only one where a redirect sends visitors on from that path again: a chain that comes back to a path no redirect answers ends there.
_Avoid_: loop, cycle

**Suggestion**:
A redirect with the status Suggested: what a move saves from the old path of the document at the top of a branch and its subpaths, to that document. Someone says yes, which sets it On, opens it to change it first, or says no, which deletes it, in its notice or in the list. None is written from an old path a redirect that is On or Off holds, and each document right below that moved with it gets its own instead.
_Avoid_: proposal, pending redirect, draft, auto-redirect

**Suggest redirects**:
What a move does with `suggestRedirects`: one suggestion per moved branch, and the suggestions and any redirect to the moved document deleted from the path it moved to, as the suggestions are from the path a document is published at.
_Avoid_: redirect old paths, leave behind, generate, migrate

**Notice**:
What a document a redirect can send visitors to shows above its fields for each suggestion to it, such as This page moved from /about-us to /company, with the buttons Yes, redirect them, Edit, which opens the suggestion, and No. A field that stores nothing, `redirectSuggestions`, renders it, and reads it again after every save.
_Avoid_: banner, alert, prompt, popup

**Collections a redirect can send visitors to**:
The collections a document target can be of: `collections` of `redirectsPlugin()`. Code says `collections`.
_Avoid_: linked collections, relation collections, target collections in prose

**Document path**:
The path a document a redirect sends visitors to is at now, which the site's `buildDocumentPath` builds from the document the lookup read, by the site's own rules, such as the path `@payloadpack/path` keeps on it. The lookup reads only the fields the site's `documentSelect` names.
_Avoid_: path field, URL field, resolve

**Refusal**:
The message a save of a redirect gets when the collection stops it, on the field. It says what to write instead.
_Avoid_: error, violation

**Page route**:
The site's catch-all route that renders its pages, which asks for a redirect only when no page holds the path. It pays nothing on a page view, and never sees the query string of a page cached per path. With `winOverDocuments`, the proxy answers every redirect, and the page route asks for none.
_Avoid_: catch-all, for the place a site checks; middleware

**Proxy**:
Next's `proxy.ts`, which runs before every page and sees the whole URL. By default a site checks there for redirects from a query string, sends a URL without one on at once, and lets a page win over a redirect that didn't match the query string. With `winOverDocuments`, it checks every request and answers every redirect `findRedirect` finds.
_Avoid_: middleware, edge function

**Path**, **move**, **branch**, **lift**:
As `@payloadpack/path` names them. See its naming.
