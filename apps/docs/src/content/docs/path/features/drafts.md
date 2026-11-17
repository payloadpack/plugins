---
title: Drafts
description: A published document stays at its path while a draft plans another, and a document that isn't published follows its draft at once.
---

With drafts on, a document's path follows what the editor saves, and the published document keeps its own until the next publish:

- A draft save stores the path the document will have in its latest version, so the editor sees it in the sidebar.
- Publishing puts the document at that path, and moves the documents below it along.
- A draft's new slug or parent on a published document is a pending move. It takes no path, so two of them may plan the same one. Publishing checks it again, because another document may be at it by then.
- A document that isn't published follows its draft at once: its path changes when the draft is saved, and the documents below it follow.

## Autosave

An autosave is checked like any save. A new document is saved before it has a title, so without a slug and without a path, and the autosave that gives it a title gives it both. A draft without a slug can't be published.

## Previews

`findByPath` returns published documents. Pass `draft: true` to find the latest draft at a path, for a preview:

```ts
const found = await findByPath({ draft: true, path: '/plans', payload })
```
