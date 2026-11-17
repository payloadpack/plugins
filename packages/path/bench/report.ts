import { readFile, writeFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { fileURLToPath } from 'node:url'

import type { DatabaseName } from '../test/support/setups.js'
import { METHOD_LABELS, METHODS, type Method } from './compared.js'

export type Timing = { median: number; p95: number }

export type SetupResults = {
  database: DatabaseName
  localized: boolean
  // Only the setups without localization compare the other ways of finding a page.
  lookups: ({ depth: number; method: Method } & Timing)[]
  moves: ({ below: number; method: Method; runs: number } & Timing)[]
  operations: ({ name: string } & Timing)[]
}

export type Run = { compared: boolean; documents: number; lookupRuns: number }

// The documents of the full run, the only run that writes its numbers.
export const FULL_RUN_DOCUMENTS = 100_000

/**
 * Where the full run writes its numbers: the JSON the docs' speed page renders its tables and charts
 * from, and the README, whose table sits between the two markers and is written whole each time.
 */
export const REPORT_FILES = {
  json: fileURLToPath(new URL('../../../apps/docs/src/data/path-speed.json', import.meta.url)),
  readme: fileURLToPath(new URL('../README.md', import.meta.url))
}
const TABLE_START = '<!-- speed-table:start -->'
const TABLE_END = '<!-- speed-table:end -->'

// Every database the full run times, by the name the tables give it.
const DATABASE_LABELS: Record<DatabaseName, string> = { mongodb: 'MongoDB', postgres: 'Postgres', sqlite: 'SQLite' }

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024).toLocaleString('en')} MB`

// The worker's memory, so a run the system stops shows how far it had grown.
export function logMemory(moment: string) {
  const { heapUsed, rss } = process.memoryUsage()
  console.log(`${moment}: memory ${megabytes(rss)}, heap ${megabytes(heapUsed)}`)
}

// The two decimals the JSON keeps, so every table formats the number the speed page reads.
const rounded = <Row extends Timing>(row: Row): Row => ({
  ...row,
  median: Math.round(row.median * 100) / 100,
  p95: Math.round(row.p95 * 100) / 100
})

// A time as the speed page shows it: a decimal below 10, none from there, and seconds from 1,000 ms.
function formatTime(milliseconds: number) {
  const [amount, unit] = milliseconds >= 1_000 ? [milliseconds / 1_000, 's'] : [milliseconds, 'ms']
  return `${amount.toLocaleString('en', { maximumFractionDigits: amount < 10 ? 1 : 0 })} ${unit}`
}

function formatTiming(timing: Timing) {
  const { median, p95 } = rounded(timing)
  return `${formatTime(median)} (p95 ${formatTime(p95)})`
}

// A Markdown table with its columns padded to one width, as Prettier formats the README's.
function markdownTable(header: string[], rows: string[][]) {
  const widths = header.map((title, column) => Math.max(3, title.length, ...rows.map((row) => row[column]!.length)))
  const line = (cells: string[]) => `| ${cells.map((cell, column) => cell.padEnd(widths[column]!)).join(' | ')} |`
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n')
}

const printTable = (title: string, table: string) => console.log(`\n${title}, median and 95th percentile:\n\n${table}`)

const setupName = ({ database, localized }: Pick<SetupResults, 'database' | 'localized'>) =>
  `${database}${localized ? ', localized' : ''}`

const methodsIn = (rows: { method: Method }[]) => METHODS.filter((method) => rows.some((row) => row.method === method))

function printComparison(results: SetupResults) {
  const name = setupName(results)
  if (results.lookups.length > 0) {
    const methods = methodsIn(results.lookups)
    const depths = [...new Set(results.lookups.map(({ depth }) => depth))]
    printTable(
      `${name}, lookups by method`,
      markdownTable(
        ['Depth', ...methods.map((method) => METHOD_LABELS[method])],
        depths.map((depth) => [
          `${depth} ${depth === 1 ? 'segment' : 'segments'}`,
          ...methods.map((method) =>
            formatTiming(results.lookups.find((lookup) => lookup.depth === depth && lookup.method === method)!)
          )
        ])
      )
    )
  }
  const methods = methodsIn(results.moves)
  const sizes = [...new Set(results.moves.map(({ below }) => below))]
  printTable(
    `${name}, moves by pages below`,
    markdownTable(
      ['Pages below', ...methods.map((method) => METHOD_LABELS[method])],
      sizes.map((below) => [
        below.toLocaleString('en'),
        ...methods.map((method) => {
          const move = results.moves.find((row) => row.below === below && row.method === method)
          return move ? `${formatTiming(move)}, ${move.runs} runs` : '-'
        })
      ])
    )
  )
}

// Printed as soon as a setup is timed, so a later setup that fails loses nothing of this one.
export function printSetup(results: SetupResults) {
  printTable(
    setupName(results),
    markdownTable(
      ['Operation', 'Time'],
      results.operations.map((operation) => [operation.name, formatTiming(operation)])
    )
  )
  printComparison(results)
}

// The benchmark's own tables, which the README shows too: each operation by database, without and
// with localization.
function summaryTables(allResults: SetupResults[]) {
  return [false, true].flatMap((localized) => {
    const setups = allResults.filter((results) => results.localized === localized)
    if (setups.length === 0) return []
    const table = markdownTable(
      ['Operation', ...setups.map(({ database }) => DATABASE_LABELS[database])],
      setups[0]!.operations.map(({ name }) => [
        name,
        ...setups.map(({ operations }) => formatTiming(operations.find((operation) => operation.name === name)!))
      ])
    )
    return [{ table, title: localized ? 'With localization (two locales)' : 'Without localization' }]
  })
}

export function printAll(allResults: SetupResults[]) {
  for (const { table, title } of summaryTables(allResults)) printTable(title, table)
  for (const results of allResults) printComparison(results)
}

/**
 * What keeps a run from being the full run, which has FULL_RUN_DOCUMENTS documents, the comparison,
 * and every database timed without and with localization. A setup that PATH_TEST_DATABASES leaves
 * out and one that failed both show as not timed.
 */
function findShortfalls(run: Run, timed: number) {
  const setups = Object.keys(DATABASE_LABELS).length * 2
  return [
    run.documents === FULL_RUN_DOCUMENTS
      ? []
      : [`had ${run.documents.toLocaleString('en')} documents instead of ${FULL_RUN_DOCUMENTS.toLocaleString('en')}`],
    run.compared ? [] : ['left out the comparison'],
    timed === setups ? [] : [`timed ${timed} of the ${setups} setups`]
  ].flat()
}

// The README around its table: up to the start marker, and from the end marker on.
async function readAroundTable(file: string) {
  const readme = await readFile(file, 'utf8')
  const [start, end] = [readme.indexOf(TABLE_START), readme.indexOf(TABLE_END)]
  if (start === -1 || end < start) {
    throw new Error(`${file} needs ${TABLE_START} and ${TABLE_END}, in that order, for the table to go between.`)
  }
  return { after: readme.slice(end), before: readme.slice(0, start) }
}

/**
 * Before a run seeds anything: a run that writes once each of its setups is timed finds out here
 * that the README has no place for its table, not an hour later.
 */
export async function checkReadme(run: Run, setups: number, files: typeof REPORT_FILES) {
  if (findShortfalls(run, setups).length === 0) await readAroundTable(files.readme)
}

// Joins what a run fell short in, as in "a, b and c".
const SHORTFALL_LIST = new Intl.ListFormat('en', { type: 'conjunction' })

/**
 * Writes the full run's numbers, with what they ran on, to the JSON and to the README's table. Any
 * other run writes nothing and says why, so neither file ever holds a small run's numbers or mixes
 * two runs.
 */
export async function writeReport(allResults: SetupResults[], run: Run, files: typeof REPORT_FILES) {
  const shortfalls = findShortfalls(run, allResults.length)
  if (shortfalls.length > 0) {
    const list = SHORTFALL_LIST.format(shortfalls)
    console.log(`\nNothing written, because only the full run writes its numbers: this one ${list}.`)
    return
  }
  const ranOn = {
    date: new Date().toISOString().slice(0, 10),
    documents: run.documents,
    lookupRuns: run.lookupRuns,
    memoryGigabytes: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    processor: cpus()[0]?.model ?? 'an unknown processor'
  }
  const report = {
    ranOn,
    // In the order the charts give them their colors.
    methods: METHODS.map((method) => ({ id: method, label: METHOD_LABELS[method] })),
    setups: allResults.map((results) => ({
      ...results,
      lookups: results.lookups.map(rounded),
      moves: results.moves.map(rounded),
      operations: results.operations.map(rounded)
    }))
  }
  const { after, before } = await readAroundTable(files.readme)
  const readmeTable = [
    `The median and 95th percentile (p95) of each, on a database with ${ranOn.documents.toLocaleString('en')} documents. Run on ${ranOn.date}, on ${ranOn.processor} with ${ranOn.memoryGigabytes} GB of memory and Node ${ranOn.node.replace(/^v/, '')}.`,
    ...summaryTables(allResults).flatMap(({ table, title }) => [`${title}:`, table])
  ].join('\n\n')
  await writeFile(files.json, `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(files.readme, `${before}${TABLE_START}\n\n${readmeTable}\n\n${after}`)
  console.log(`\nWritten to ${files.json} and ${files.readme}.`)
}
