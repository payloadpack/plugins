import type { CollectionSlug, Config, Field, PolymorphicRelationshipField } from 'payload'
import { traverseFields } from 'payload/shared'

import { emptyRelationToError, relationToWithoutPathError } from '../plugin/messages.js'
import { PATH_RELATIONSHIP_FIELD_KEY, type PathCollectionSlug } from '../plugin/options.js'

// Omits the keys from each member of a union, so the hasMany form and the single form of a
// relationship field keep their own properties.
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never

// What pathRelationshipField keeps in the field's custom: the collections it was given, if any.
type PathRelationshipFieldOptions = { relationTo?: PathCollectionSlug[] }

/**
 * A relationship field that picks a document of a collection with a path, for a link in a block, a
 * global or a collection, which is built before the config exists. It takes a relationship field's
 * config without type, and keeps the relationTo it is given, if any, in the field's custom, which
 * Payload keeps on the server. pathPlugin() sets relationTo when it runs: to that list, once it has
 * checked that each of them has a path, or else to the slugs getPathCollectionSlugs gives.
 * relationTo is always a list, so a value is { relationTo, value } even with one collection.
 */
export function pathRelationshipField(
  field: OmitFromEach<PolymorphicRelationshipField, 'relationTo' | 'type'> & { relationTo?: PathCollectionSlug[] }
): PolymorphicRelationshipField {
  const options: PathRelationshipFieldOptions = field.relationTo ? { relationTo: [...field.relationTo] } : {}
  return { ...field, custom: { ...field.custom, [PATH_RELATIONSHIP_FIELD_KEY]: options }, relationTo: [], type: 'relationship' }
}

/**
 * Sets the relationTo of each field made with pathRelationshipField, in place: to the collections
 * it was given, which must have a path, or else to every collection with a path, in their order.
 */
export function fillPathRelationshipFields(fields: PolymorphicRelationshipField[], slugs: CollectionSlug[]) {
  for (const field of fields) {
    const { relationTo } = field.custom?.[PATH_RELATIONSHIP_FIELD_KEY] as PathRelationshipFieldOptions
    if (!relationTo) {
      field.relationTo = [...slugs]
      continue
    }
    if (relationTo.length === 0) throw new Error(emptyRelationToError(field.name))
    const slugsWithoutPath = relationTo.filter((slug) => !slugs.includes(slug))
    if (slugsWithoutPath.length > 0) throw new Error(relationToWithoutPathError(slugsWithoutPath, field.name))
    field.relationTo = [...relationTo]
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
