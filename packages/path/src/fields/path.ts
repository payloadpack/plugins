import type { TextField } from 'payload'

// Localized where the collection's documents have a path per locale.
export function pathField(localized: boolean): TextField {
  return {
    name: 'path',
    type: 'text',
    admin: { position: 'sidebar', readOnly: true },
    index: true,
    localized
  }
}
