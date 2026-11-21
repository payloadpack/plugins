import type { CheckboxField } from 'payload'

export const WINS_OVER_DOCUMENT_FIELD_NAME = 'winsOverDocument'

/**
 * Whether a redirect answers even where a document holds the path asked for, which an editor picks
 * per redirect with winOverDocuments 'perRedirect'. A suggestion said yes to keeps it unchecked.
 */
export const buildWinsOverDocumentField = (): CheckboxField => ({
  name: WINS_OVER_DOCUMENT_FIELD_NAME,
  type: 'checkbox',
  admin: { position: 'sidebar' },
  defaultValue: false,
  label: 'Wins over a page'
})
