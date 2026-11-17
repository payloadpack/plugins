---
title: Languages
description: Each locale has a path of its own, or a collection keeps one path for all of them. The locale is never part of it, and your routes decide where it goes.
---

With localization in your Payload config, a collection's slug and path are localized, unless you give the collection [`localized: false`](#a-collection-that-isnt-localized). Each locale gets a path from its own slug and its parent's path in that locale:

| Locale | Parent's path | Slug   | Path           |
| ------ | ------------- | ------ | -------------- |
| `en`   | `/about`      | `team` | `/about/team`  |
| `sv`   | `/om-oss`     | none   | `/om-oss/team` |

A [base path](/path/features/paths/#base-paths) is the same in every locale, so with posts at `/blog`, a top-level post is at `/blog/hello-world` in English and `/blog/hej-varlden` in Swedish.

## A locale without a slug

A locale without a slug of its own takes the slug it falls back to: the locale's `fallbackLocale`, else the default locale when fallback is on, else any locale that has one. So every locale has a path as soon as one has a slug, and a move never meets a locale without a path. A collection without drafts is the one exception, described below.

Renaming the English slug moves the Swedish path too, while Swedish has no slug of its own. The plugin checks that path as well, and names the locale when it is taken:

> Page "Shop" is already at /butik in sv, so change the slug or the parent.

A collection without drafts is the exception. A locale gets its path once the document is saved in it, and that save keeps the slug the locale falls back to as its own, unless the editor types one. A locale the document was never saved in has no path.

## One locale at a time

- A path is taken per locale. `/contact` may be one page in English and another in Swedish.
- Each locale is published on its own, and a locale takes its path whether it is published or not.
- A move rewrites the paths of the locales whose path changed, and leaves the others alone.
- Reserved segments and the root slug are checked per locale.

## A locale that isn't published

A document can be published in one locale and a draft in another. Each locale then goes by its own status:

- In a locale the document is published in, it stays where it was published. A draft's new slug there is a pending move until that locale is published.
- In a locale it isn't published in, it follows that locale's own draft at once, and the documents below it move along in that locale.
- Publishing one locale never moves another locale that has a slug of its own.
- The parent is the same in every locale, so a draft's new parent stays pending while the document is published in any locale.

## A collection that isn't localized

Some collections should be at the same path in every language. Give such a collection `localized: false`:

```ts title="payload.config.ts"
pathPlugin({ collections: ['pages', { slug: 'topics', basePath: '/topics', localized: false }] })
```

A topic then has one slug and one path, the same in every locale, so the sections above don't apply to it. A slug typed in one locale is the slug in every locale, and a new slug saved in any locale renames the topic in all of them. A topic without a slug takes one from its title in the locale of the save.

A few things follow from the one path:

- It is taken in every locale. A page that is at `/topics/crops` in one locale only is still in the way of a topic there, and a topic keeps a page from its path in every locale. The messages are the ones on [One document per path](/path/features/taken-paths/#in-another-language).
- Publishing is still per locale where Payload keeps a status per locale, which it does in a collection with a localized field of its own, such as a localized title. `findByPath` finds the document under each locale it is published in. A collection without any localized field has one status, so a publish there publishes the document in every locale at once.
- A draft's new slug on a document that is published in any locale is a pending move, and a publish in any locale moves the document and everything below it in every locale. A document that is published in no locale follows its draft at once.
- `onPathsChanged` hears it in the same shape as any other collection. Each path still names a locale, so your function needs nothing extra.

### Switching a collection that has documents

Changing `localized` on a collection that already has documents is a migration you write, as for any Payload field whose `localized` changes. Payload stores a localized value per locale and one that isn't once, so copy the slugs to where the field now lives, in the documents and in their versions. On the way to `localized: false`, pick the locale whose slug to keep. Then run [`backfillPaths`](/path/installation/#documents-you-already-have) once to write the paths.

The plugin doesn't copy the slugs for you, and it doesn't notice when they haven't been copied.

## Routing

The locale is never part of the path, so your site decides where it goes, in a prefix, a domain or a cookie. With a prefix, strip it and pass it on:

```ts title="app/[locale]/[[...segments]]/page.tsx"
import { findByPath } from '@payloadpack/path'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@payload-config'

export default async function Page({ params }: { params: Promise<{ locale: string; segments?: string[] }> }) {
  const { locale, segments = [] } = await params
  const payload = await getPayload({ config })
  const found = await findByPath({ locale, path: `/${segments.join('/')}`, payload })
  if (!found) notFound()
  // Render found.document, which is a found.collection document.
}
```

Without localization, leave `locale` out.
