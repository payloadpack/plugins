import { findByPath } from '@payloadpack/path'
import type { Payload } from 'payload'

// The page at a path, or null: the document @payloadpack/path finds published there.
export async function findPage({ path, payload }: { path: string; payload: Payload }) {
  return (await findByPath({ path, payload }))?.document ?? null
}
