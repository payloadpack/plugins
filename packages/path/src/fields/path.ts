import type { TextField } from 'payload'

export function pathField(localized: boolean): TextField {
  return {
    name: 'path',
    type: 'text',
    admin: { position: 'sidebar', readOnly: true },
    index: true,
    localized
  }
}
