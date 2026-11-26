import type { CollectionSlug, Config, Field, PolymorphicRelationshipField } from 'payload'
import { traverseFields } from 'payload/shared'

import { emptyRelationToError, relationToWithoutPathError } from '../plugin/messages.js'
import { PATH_RELATIONSHIP_FIELD_KEY, type PathCollectionSlug } from '../plugin/options.js'

// Omits the keys from each member of a union, so the hasMany form and the single form of a
// relationship field keep their own properties.
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never

// What pathRelationshipField keeps in the field's custom: whether pathPlugin() sets the
// field's relationTo to every collection with a path, because it was given none. It is set once, so
// it still holds after the plugin has set them: the plugin decides by it, and never by the field's
// relationTo, which the first build of a config fills.
type PathRelationshipFieldOptions = { setPathCollections: boolean }

/**
 * A relationship field that picks a document of a collection with a path, for a link in a block, a
 * global or a collection, which is built before the config exists. It takes a relationship field's
 * config without type. A relationTo it is given is the field's from the start, in its order, so a
 * field pathPlugin() can't reach, such as one in the fields of Lexical's LinkFeature, can pass
 * getPathCollectionSlugs(config). Without one, its relationTo starts empty. pathPlugin() then sets it
 * to the slugs getPathCollectionSlugs gives, and checks that each collection of a given list has a
 * path. relationTo is always a list, so a value is { relationTo, value } even with one collection.
 */
export function pathRelationshipField(
  field: OmitFromEach<PolymorphicRelationshipField, 'relationTo' | 'type'> & { relationTo?: PathCollectionSlug[] }
): PolymorphicRelationshipField {
  const options: PathRelationshipFieldOptions = { setPathCollections: !field.relationTo }
  return {
    ...field,
    custom: { ...field.custom, [PATH_RELATIONSHIP_FIELD_KEY]: options },
    relationTo: [...(field.relationTo ?? [])],
    type: 'relationship'
  }
}

/**
 * Sets the relationTo of each field made with pathRelationshipField without one, in place, to every
 * collection with a path, in their order, and checks that the one each other field was given is not
 * empty and names only collections with a path.
 */
export function fillPathRelationshipFields(fields: PolymorphicRelationshipField[], slugs: CollectionSlug[]) {
  for (const field of fields) {
    const { setPathCollections } = field.custom?.[PATH_RELATIONSHIP_FIELD_KEY] as PathRelationshipFieldOptions
    if (setPathCollections) {
      field.relationTo = [...slugs]
      continue
    }
    if (field.relationTo.length === 0) throw new Error(emptyRelationToError(field.name))
    const slugsWithoutPath = field.relationTo.filter((slug) => !slugs.includes(slug))
    if (slugsWithoutPath.length > 0) throw new Error(relationToWithoutPathError(slugsWithoutPath, field.name))
  }
}

// Every list of fields the config holds outside a field. A rich text editor's fields aren't in it:
// Payload builds them while it sanitizes the config.
function listFieldLists({ admin, blocks = [], collections = [], globals = [], jobs, queryPresets }: Config): Field[][] {
  return [
    ...[...collections, ...globals, ...blocks].map(({ fields }) => fields),
    ...(admin?.dashboard?.widgets ?? []).map(({ fields = [] }) => fields),
    ...Object.values(queryPresets?.constraints ?? {}).flatMap((constraints = []) => constraints.map(({ fields = [] }) => fields)),
    ...(jobs?.tasks ?? []).flatMap(({ inputSchema = [], outputSchema = [] }) => [inputSchema, outputSchema]),
    ...(jobs?.workflows ?? []).map(({ inputSchema = [] }) => inputSchema)
  ]
}

// Every field made with pathRelationshipField in the config, at any depth. A block used in several
// places is one field object, so each one is listed once.
export function listPathRelationshipFields(config: Config) {
  const pathRelationshipFields = new Set<PolymorphicRelationshipField>()
  for (const fields of listFieldLists(config)) {
    // Without the config, a blocks field skips the blocks it names by slug, which the walk of the
    // config's own blocks reaches.
    traverseFields({
      callback: ({ field }) => {
        // A callback that returns true stops the walk, so this one returns nothing.
        if (field.type === 'relationship' && field.custom?.[PATH_RELATIONSHIP_FIELD_KEY]) {
          pathRelationshipFields.add(field as PolymorphicRelationshipField)
        }
      },
      fields
    })
  }
  return [...pathRelationshipFields]
}
