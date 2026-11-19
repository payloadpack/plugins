import type { PayloadRequest } from 'payload'

import { HOME_PAGE_PATH, type Id, type ParentPathAndAncestors } from '../path/build-path-and-ancestors.js'
import {
  BELOW_ITSELF_REFUSAL,
  buildFieldError,
  homePageParentRefusal,
  MISSING_PARENT_REFUSAL,
  PARENT_WITHOUT_PATH_REFUSAL
} from '../plugin/messages.js'
import { getParentRefusalField } from '../plugin/options.js'

/**
 * Refuses a parent a document can't sit below: one that doesn't exist, the document itself or one
 * below it, one without a path, and the home page.
 */
export function checkParent(
  collection: string,
  { id, parent, parentId }: { id: Id | undefined; parent: ParentPathAndAncestors | null; parentId: Id | null },
  req: PayloadRequest
) {
  if (parentId === null) return
  const field = getParentRefusalField(collection, req.payload)
  if (!parent) throw buildFieldError(collection, field, MISSING_PARENT_REFUSAL, req)
  if (id !== undefined && [parent.id, ...parent.ancestors].some((above) => String(above) === String(id))) {
    throw buildFieldError(collection, field, BELOW_ITSELF_REFUSAL, req)
  }
  // A parent without a slug, or one stored before the plugin was added, has no path until it is saved.
  if (Object.values(parent.paths).every((parentPath) => parentPath === null)) {
    throw buildFieldError(collection, field, PARENT_WITHOUT_PATH_REFUSAL, req)
  }
  if (Object.values(parent.paths).includes(HOME_PAGE_PATH)) {
    throw buildFieldError(collection, field, homePageParentRefusal(collection, req), req)
  }
}
