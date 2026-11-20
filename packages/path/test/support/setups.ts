const DATABASES = ['mongodb', 'postgres', 'sqlite'] as const
export type DatabaseName = (typeof DATABASES)[number]

export type Setup = { database: DatabaseName; localized: boolean; name: string }

function readTestedDatabases(): DatabaseName[] {
  const names = (process.env.PATH_TEST_DATABASES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (names.length === 0) return [...DATABASES]
  const unknown = names.filter((name) => !(DATABASES as readonly string[]).includes(name))
  if (unknown.length > 0) {
    throw new Error(`PATH_TEST_DATABASES names ${unknown.join(', ')}, so name ${DATABASES.join(', ')} or some of them.`)
  }
  return DATABASES.filter((database) => names.includes(database))
}

export const TESTED_DATABASES = readTestedDatabases()

export const SETUPS: Setup[] = TESTED_DATABASES.flatMap((database) =>
  [false, true].map((localized) => ({ database, localized, name: `${database}${localized ? ', localized' : ''}` }))
)

export const LOCALES = ['en', 'sv']
