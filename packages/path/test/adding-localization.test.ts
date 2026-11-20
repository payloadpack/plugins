import { describe, expect, it } from 'vitest'

import { findByPath } from '../src/index.js'
import { startPayload, titled } from './support/boot-payload.js'
import { create, readPath, update } from './support/documents.js'
import { LOCALES, SETUPS } from './support/setups.js'

const LOCALIZATION = { defaultLocale: 'en', locales: LOCALES }

const LEDGERS = { collections: [titled('ledgers', false)], options: { collections: ['ledgers'] } }

describe.each(SETUPS.filter(({ localized }) => !localized))('$name, then with localization', (setup) => {
  it('keeps the paths its documents had, finds them in every locale, and still moves a branch', async () => {
    const before = await startPayload(setup, LEDGERS)
    const accounts = await create(before.payload, 'ledgers', { slug: 'accounts', title: 'Accounts' })
    const payable = await create(before.payload, 'ledgers', { parent: accounts.id, slug: 'payable', title: 'Payable' })
    await before.payload.destroy()

    const { payload } = await startPayload(setup, { ...LEDGERS, database: before.database, localization: LOCALIZATION })
    try {
      for (const locale of LOCALES) {
        expect(await findByPath({ locale, path: '/accounts/payable', payload })).toMatchObject({ document: { id: payable.id } })
      }
      await update(payload, 'ledgers', accounts.id, { slug: 'books' }, { locale: 'sv' })
      for (const locale of LOCALES) {
        expect(await readPath(payload, 'ledgers', payable.id, { locale })).toBe('/books/payable')
      }
    } finally {
      await payload.destroy()
    }
  })
})
