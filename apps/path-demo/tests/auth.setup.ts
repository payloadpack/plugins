import { expect, test as setup } from '@playwright/test'

import { DEMO_USER } from '../src/seed'
import { demo } from './demo'

setup('log in as the demo user', async ({ request }) => {
  await expect(await request.post('/api/users/login', { data: DEMO_USER })).toBeOK()
  await request.storageState({ path: demo().authFile })
})
