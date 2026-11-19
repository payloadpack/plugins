import type { PayloadRequest } from 'payload'

import { isSlug } from '../path/build-path-and-ancestors.js'
import { buildFieldError, MISSING_SLUG_REFUSAL, REFUSAL_FIELD } from '../plugin/messages.js'

/**
 * Refuses a document without a slug to make a path from: none of the slugs given is one, by what
 * the rule of a path takes for a slug.
 */
export function checkSlugs(collection: string, slugs: unknown[], req: PayloadRequest) {
  if (!slugs.some(isSlug)) {
    throw buildFieldError(collection, REFUSAL_FIELD, MISSING_SLUG_REFUSAL, req)
  }
}
