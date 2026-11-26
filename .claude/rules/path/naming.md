---
paths:
  - 'packages/path/**'
  - 'apps/path-demo/**'
  - 'apps/docs/src/content/docs/path/**'
  - 'apps/docs/src/components/path/**'
  - 'apps/docs/src/data/path-*'
---

# Path naming

The terms for a plugin that gives Payload documents a stored URL path, made from a parent and a slug.

## Language

**Path**:
Where a document answers on the site: its parent's path, a slash and its slug, such as `/about/team`. A top-level document's path starts with its collection's base path, or at the root without one. Stored on the document, and never holds a locale. A URL is what a visitor asks for, which holds the path and maybe a locale.
_Avoid_: route, permalink, full slug, and URL for the stored path itself

**Slug**:
A document's own segment of its path.
_Avoid_: handle, key, name

**Parent**:
The document of the same collection that a document sits below: a page below a page, a post below a post. Code and config say `parent`. Call it a parent page only when it is a page.
_Avoid_: parent document, folder, and parent page for a parent that isn't a page

**Parent field**:
The field a document holds its parent in: the plugin's own `parent`, or the parent field of Payload's hierarchy in a collection whose own config has `hierarchy`, or the `folders` or `tags` preset. A collection given with `parent: false` has none, and every document of it is top-level.
_Avoid_: tree field, hierarchy field, and parent field for a relationship to another collection

**Ancestors**:
The ids of the documents above a document, top-down, stored so a move finds its whole branch at once. The last of them is the document's parent, and a collection without a parent field stores none.
_Avoid_: breadcrumbs, lineage

**Branch**:
A document and every document below it, at any depth. A branch stays inside one collection.
_Avoid_: subtree, descendants, children, which means one level only

**Path and ancestors**:
What says where a document is: its path in each locale and its ancestors. The document itself stores them, and the documents below it hang from them. Where a document is published, they are where it was published; where it isn't, they are where its latest draft says. The latest version stores the ones its draft would give, which without a pending move are the document's own. Code says `PathAndAncestors`, and `draft` for the latest version's.
_Avoid_: place, plan, position, location

**Move**:
A save that changes a document's path or ancestors, and with them the paths of its whole branch. A published document moves when it is published, and one that isn't follows its draft.
_Avoid_: reparent, cascade

**Pending move**:
A draft's new slug or parent on a published document, which the document takes when the draft is published.

**Lift**:
What a delete does to the documents right below the deleted document: they move up one level.
_Avoid_: promote, orphan, reparent

**Chunk**:
The most documents or paths a move names in one read or check, asks for in one read, or writes with one round of its statements. A branch of any size is read, checked and written a chunk at a time.
_Avoid_: batch, and page, which is a document

**Statements**:
The package's own writes of the documents below a moved or deleted document and of their latest versions: a few for each chunk of rows, in the request's transaction. They store the path the move built for each row, and where the row holds other ones the ancestors and the parent, and leave every other value of the row.
_Avoid_: query, raw SQL, bulk update

**Round trip**:
The time a query takes to reach the database and come back, on top of the database's own work. A site on the same machine as its database has next to none, and a site on another machine waits for it on every query.
_Avoid_: lag, ping

**Taken path**:
A path a document is at. Every document takes its path, whatever its status, except one in the trash; a pending move takes nothing until the document moves. A document of a bulk update also takes the paths it is about to put documents at, until it has written, so two documents of one bulk update can't land on the same path. What it takes is kept by that bulk update only, so it never refuses anything after it.
_Avoid_: holder, owner, conflict

**Trash**:
Where a collection with Payload's `trash` keeps a deleted document until it is deleted for good. A document in the trash takes no path and keeps the path and ancestors it stores, and it takes its paths again when it is taken out of the trash.
_Avoid_: soft delete, bin, archive

**Backfill**:
A run of `backfillPaths`, which gives every document the path and ancestors its slug and its parent make, where it stores other ones or none: the documents a site had before the plugin, and the ones a move that stopped halfway left behind. A document it can't give a path is left as it is, with the refusal a save would get, and so is a document at a path another document is at too, with the refusal that names the other.
_Avoid_: migrate, rebuild, reindex

**Localized**:
Said of a collection whose documents have a slug and a path per locale: one given with `localized: true`, in a site with localization. The documents of every other collection have one slug and one path, the same in every locale. Config says `localized`.
_Avoid_: synced, shared path, per market

**Plugin's collections**:
The collections whose documents get a path: each one listed in the plugin's `collections` or wrapped in `withPath` in its own config, never both. Code says `pathCollections` for all of them.
_Avoid_: marked, tagged or registered collection

**Path relationship field**:
A site's relationship field made with `pathRelationshipField`, which picks a document of the plugin's collections: all of them, or the ones it is given in `relationTo`. It is built before the config exists, so `pathPlugin()` sets the `relationTo` of one given none when it runs, wherever the field sits, and checks the list of every other one it finds. Code says `pathRelationshipFields` for all of them.
_Avoid_: marked field, link field, which is a site's own field that may hold one

**Field options**:
What a site sets on the slug field or the plugin's own parent field with `slugField` and `parentField`, as Payload's own field config. The plugin keeps each field's name, type and whether it is localized.
_Avoid_: field overrides, field config

**Home page**:
The top-level document whose slug is the root slug, in a collection without a base path. Its path is the root, `/`. Config says `rootSlug`.
_Avoid_: root page, index page, front page, and home slug for the root slug

**Root**:
The path `/`. A segment at the root is a path's first segment, such as `api` in `/api/docs`, so a base path's first segment is one too. `rootSlug` names the slug of the document that answers the root.
_Avoid_: top level, for the path, and root page for the document at `/`

**Top-level**:
Said of a document without a parent. It sits at the root, or at its collection's base path.
_Avoid_: at the root, root document, orphan

**Base path**:
What the paths of a collection's top-level documents start with, such as `/blog` for posts, set per collection and optional. A collection without one has its top-level documents at the root.
_Avoid_: path prefix, route prefix, mount point, base URL

**Reserved segment**:
A segment the site serves itself, at the root or at any depth, each with why. The docs call them reserved slugs, which is what an editor meets.
_Avoid_: blocked slug, forbidden path, blacklist

**Refusal**:
The message a save, move or delete gets when the plugin stops it. It names what is in the way and what to change.
_Avoid_: error, violation, conflict

**Limit**:
A case where the package can't keep a promise, with what it leaves and what puts it right: two requests at the same time, a bulk update, or a refusal after the write on a database without transactions. The docs page Limits lists the ones a site can see, and `limits.md` in these rules lists all of them.
_Avoid_: bug, quirk, caveat, known issue, edge case
