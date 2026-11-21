import type { Payload } from 'payload'

/**
 * The page at a path as a visitor reads it, or null. Both proxies ask it where a site with
 * @payloadpack/path calls findByPath, since this app's pages hold a path field of their own.
 */
export async function findPage({ path, payload }: { path: string; payload: Payload }) {
  const { docs } = await payload.find({
    collection: 'pages',
    depth: 0,
    limit: 1,
    overrideAccess: false,
    pagination: false,
    select: {},
    where: { path: { equals: path } }
  })
  return docs[0] ?? null
}
