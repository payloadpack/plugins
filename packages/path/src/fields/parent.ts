import type { CollectionSlug, FilterOptions, FilterOptionsProps, RelationshipField, Where } from 'payload'

import { HOME_PAGE_PATH } from '../path/build-path-and-ancestors.js'
import { PARENT_FIELD_NAME, type ParentFieldOptions } from '../plugin/options.js'

// The picker leaves out the document itself and the home page, which holds no documents.
const leaveOutItselfAndHomePage = ({ id }: Pick<FilterOptionsProps, 'id'>): Where => ({
  ...(id === undefined ? {} : { id: { not_equals: id } }),
  path: { not_equals: HOME_PAGE_PATH }
})

// The site's own filter holds too. It is a where, or a function that gives one, true for every
// document or false for none, as Payload takes it.
const withSiteFilter =
  (siteFilter: FilterOptions) =>
  async (options: FilterOptionsProps): Promise<false | Where> => {
    const site = typeof siteFilter === 'function' ? await siteFilter(options) : siteFilter
    if (site === false) return false
    const own = leaveOutItselfAndHomePage(options)
    return site === true || site === null || site === undefined ? own : { and: [own, site] }
  }

// A document sits below a document of its own collection, so each collection is a tree of its own.
// A save refuses the document itself, the home page and the documents below the document itself,
// whatever the picker offered. What the site sets on the field goes over the plugin's own admin.
export function parentField(
  collectionSlug: CollectionSlug,
  { admin, filterOptions, ...asGiven }: ParentFieldOptions = {}
): RelationshipField {
  return {
    ...asGiven,
    name: PARENT_FIELD_NAME,
    type: 'relationship',
    admin: { position: 'sidebar', ...admin },
    filterOptions: filterOptions === undefined ? leaveOutItselfAndHomePage : withSiteFilter(filterOptions),
    index: true,
    relationTo: collectionSlug
  }
}
