const DATABASES = ['mongodb', 'postgres', 'sqlite'] as const
export type DatabaseName = (typeof DATABASES)[number]

export type Setup = { database: DatabaseName; name: string; transactions: boolean }

function getTestedDatabases(): DatabaseName[] {
  const names = (process.env.REDIRECTS_TEST_DATABASES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (names.length === 0) return [...DATABASES]
  const unknownNames = names.filter((name) => !(DATABASES as readonly string[]).includes(name))
  if (unknownNames.length > 0) {
    throw new Error(`REDIRECTS_TEST_DATABASES names ${unknownNames.join(', ')}, so name ${DATABASES.join(', ')} or some of them.`)
  }
  return DATABASES.filter((database) => names.includes(database))
}

export const TESTED_DATABASES = getTestedDatabases()

// Each database with transactions, and SQLite also without them, which is its default.
export const SETUPS: Setup[] = TESTED_DATABASES.flatMap((database) => [
  { database, name: database, transactions: true },
  ...(database === 'sqlite' ? [{ database, name: `${database} without transactions`, transactions: false }] : [])
])
