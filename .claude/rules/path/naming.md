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

**Place**:
Where a document is: its path in each locale and its ancestors. The document itself stores it, and the documents below it hang from it. Where a document is published, it is where it was published; where it isn't, it is where its latest draft says.

**Plan**:
Where a document's latest draft would put it, which its latest version stores. Without a pending move it is the document's place.

**Move**:
A save that changes the place of a document, and with it the paths of its whole branch. A published document moves when it is published, and one that isn't follows its draft.
_Avoid_: reparent, cascade

**Pending move**:
A draft's new slug or parent on a published document, which the document takes when the draft is published.

**Lift**:
What a delete does to the documents right below the deleted document: they move up one level.
_Avoid_: promote, orphan, reparent

**Taken path**:
A path a document is at. Every document takes its path, whatever its status, except one in the trash; a pending move takes nothing until the document moves.
_Avoid_: holder, owner, conflict

**Trash**:
Where a collection with Payload's `trash` keeps a deleted document until it is deleted for good. A document in the trash takes no path and keeps the place it stores, and it takes its paths again when it is taken out of the trash.
_Avoid_: soft delete, bin, archive

**Backfill**:
A run of `backfillPaths`, which gives every document the place the rule makes where it stores another one or none: the documents a site had before the plugin, and the ones a move that stopped halfway left behind. A document it can't place is left as it is, with the refusal a save would get.
_Avoid_: migrate, rebuild, reindex

**Localized**:
Said of a collection whose documents have a slug and a path per locale. In a site with localization every collection is, unless it is given with `localized: false`: then its documents have one slug and one path, the same in every locale. Config says `localized`.
_Avoid_: synced, shared path, per market

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
