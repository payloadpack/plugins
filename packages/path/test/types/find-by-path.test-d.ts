import type { Payload } from 'payload'
import { expectTypeOf } from 'vitest'

import { backfillPaths, findByPath, findPaths, type FoundByPath, type FoundPath } from '../../dist/index.js'

interface User {
  email: string
  id: string
}

interface PayloadMigration {
  batch?: number | null
  id: string
  name?: string | null
}

interface UsersSelect<T extends boolean = true> {
  email?: T
}

interface PayloadMigrationsSelect<T extends boolean = true> {
  batch?: T
  name?: T
}

interface Page {
  _status?: ('draft' | 'published') | null
  ancestors?: (Page | string)[] | null
  hero?: string | null
  id: string
  parent?: (Page | string) | null
  path?: string | null
  slug?: string | null
  title: string
}

interface Post {
  _status?: ('draft' | 'published') | null
  excerpt?: string | null
  id: string
  path?: string | null
  slug?: string | null
  title: string
}

interface Topic {
  id: string
  path?: string | null
  slug?: string | null
  summary?: string | null
  title: string
}

interface PagesSelect<T extends boolean = true> {
  _status?: T
  ancestors?: T
  hero?: T
  parent?: T
  path?: T
  slug?: T
  title?: T
}

interface PostsSelect<T extends boolean = true> {
  _status?: T
  excerpt?: T
  path?: T
  slug?: T
  title?: T
}

interface TopicsSelect<T extends boolean = true> {
  path?: T
  slug?: T
  summary?: T
  title?: T
}

declare module 'payload' {
  export interface GeneratedTypes {
    collections: {
      pages: Page
      'payload-migrations': PayloadMigration
      posts: Post
      topics: Topic
      users: User
    }
    collectionsSelect: {
      pages: PagesSelect<false> | PagesSelect<true>
      'payload-migrations': PayloadMigrationsSelect<false> | PayloadMigrationsSelect<true>
      posts: PostsSelect<false> | PostsSelect<true>
      topics: TopicsSelect<false> | TopicsSelect<true>
      users: UsersSelect<false> | UsersSelect<true>
    }
    fallbackLocale: ('en' | 'sv') | false | null
    locale: 'en' | 'sv'
  }
}

declare const payload: Payload

export async function verifyFindByPathTypes() {
  // 1. Default (no collections) -> automatically narrows to ONLY collections with path & slug (no users or payload-migrations)
  const all = await findByPath({ path: '/about', payload })
  expectTypeOf(all).toEqualTypeOf<
    | { collection: 'pages'; document: Page }
    | { collection: 'posts'; document: Post }
    | { collection: 'topics'; document: Topic }
    | null
  >()
  expectTypeOf(all).toEqualTypeOf<FoundByPath | null>()

  // findPaths and backfillPaths also narrow to collections with paths
  await findPaths({ collection: 'pages', id: '1', payload })
  await backfillPaths({ collections: ['pages', 'posts'], payload })

  // 2. Two collections -> discriminated union of ONLY those two collections
  const two = await findByPath({ collections: ['pages', 'posts'], path: '/about', payload })
  expectTypeOf(two).toEqualTypeOf<{ collection: 'pages'; document: Page } | { collection: 'posts'; document: Post } | null>()
  expectTypeOf(two).toEqualTypeOf<FoundByPath<'pages' | 'posts'> | null>()

  // Narrowing by found.collection gives the exact collection's document type
  if (two) {
    expectTypeOf(two.document).toEqualTypeOf<Page | Post>()
    if (two.collection === 'pages') {
      expectTypeOf(two.document).toEqualTypeOf<Page>()
      expectTypeOf(two.document.hero).toEqualTypeOf<string | null | undefined>()
    } else {
      expectTypeOf(two.document).toEqualTypeOf<Post>()
      expectTypeOf(two.document.excerpt).toEqualTypeOf<string | null | undefined>()
    }
  }

  // 3. Single collection -> only that collection
  const one = await findByPath({ collections: ['pages'], path: '/about', payload })
  expectTypeOf(one).toEqualTypeOf<{ collection: 'pages'; document: Page } | null>()

  // 4. Single collection + include select -> narrowed document fields
  const selectedOne = await findByPath({
    collections: ['pages'],
    path: '/about',
    payload,
    select: { hero: true, title: true }
  })
  expectTypeOf(selectedOne).toEqualTypeOf<{
    collection: 'pages'
    document: { hero?: string | null; id: string; title: string }
  } | null>()

  // 5. Two collections + include select (shared field) -> narrowed document on each branch
  const selectedTwo = await findByPath({
    collections: ['pages', 'posts'],
    path: '/about',
    payload,
    select: { title: true }
  })
  expectTypeOf(selectedTwo).toEqualTypeOf<
    | { collection: 'pages'; document: { id: string; title: string } }
    | { collection: 'posts'; document: { id: string; title: string } }
    | null
  >()

  // 6. Single collection + exclude select -> Omit excluded field
  const excludedOne = await findByPath({
    collections: ['posts'],
    path: '/blog/hello',
    payload,
    select: { excerpt: false }
  })
  expectTypeOf(excludedOne).toEqualTypeOf<{
    collection: 'posts'
    document: Omit<Post, 'excerpt'>
  } | null>()

  // 7. Two collections + paths: true -> union intersected with paths
  const withPaths = await findByPath({ collections: ['pages', 'posts'], path: '/about', paths: true, payload })
  expectTypeOf(withPaths).toEqualTypeOf<
    (({ collection: 'pages'; document: Page } | { collection: 'posts'; document: Post }) & { paths: FoundPath[] }) | null
  >()

  // 8. Forwarded options type-check cleanly
  await findByPath({
    collections: ['pages'],
    context: { custom: true },
    depth: 1,
    disableErrors: true,
    draft: true,
    fallbackLocale: false,
    includeLockStatus: true,
    locale: 'sv',
    overrideAccess: false,
    path: '/om-oss',
    payload,
    populate: { pages: { title: true } },
    showHiddenFields: true,
    where: { title: { equals: 'Om oss' } }
  })

  // 9. Disallowed options and invalid values are rejected by TypeScript
  if (false as boolean) {
    // @ts-expect-error locale 'all' is not allowed
    await findByPath({ locale: 'all', path: '/about', payload })
    // @ts-expect-error collection is replaced by collections
    await findByPath({ collection: 'pages', path: '/about', payload })
    // @ts-expect-error limit is omitted
    await findByPath({ limit: 1, path: '/about', payload })
    // @ts-expect-error page is omitted
    await findByPath({ page: 1, path: '/about', payload })
    // @ts-expect-error pagination is omitted
    await findByPath({ pagination: true, path: '/about', payload })
    // @ts-expect-error sort is omitted
    await findByPath({ path: '/about', payload, sort: 'title' })
    // @ts-expect-error trash is omitted
    await findByPath({ path: '/about', payload, trash: true })
    // @ts-expect-error users has no path or slug field
    await findByPath({ collections: ['users'], path: '/about', payload })
    // @ts-expect-error payload-migrations has no path or slug field
    await findPaths({ collection: 'payload-migrations', id: '1', payload })
    // @ts-expect-error invalid field in select for pages
    await findByPath({ collections: ['pages'], path: '/about', payload, select: { doesNotExist: true } })
  }
}
