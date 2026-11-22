import type { WinOverDocuments } from '@payloadpack/redirects'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type { Database } from '../src/build-config.ts'
import { VIEWED_PATHS } from '../src/viewed-paths.ts'
import { findFreePort } from './ports.ts'
import { holdStop } from './stops.ts'

// next.config.mjs picks each build's proxy by BENCH_BUILD.
export const BUILDS = ['query-string-proxy', 'win-over-documents-proxy', 'baseline'] as const

type Build = (typeof BUILDS)[number]

/** A build with a proxy, which a case times against the baseline. */
export type ProxyBuild = Exclude<Build, 'baseline'>

// payload.config.ts reads it from BENCH_WIN_OVER_DOCUMENTS. 'always' adds no field to the redirects, so
// every build reads the database the bench's own instance created and seeded without it.
const WIN_OVER_DOCUMENTS: Partial<Record<Build, WinOverDocuments>> = { 'win-over-documents-proxy': 'always' }

export type Server = {
  build: Build
  origin: string
  stop: () => Promise<void>
}

const APP_DIRECTORY = fileURLToPath(new URL('..', import.meta.url))
const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next')
const STARTED_WITHIN = 60_000

// Next itself, as Node's child, so stopping the child stops the server.
function runNext(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [NEXT_BIN, ...args], {
    cwd: APP_DIRECTORY,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk))
  const exitCode = new Promise<null | number>((resolve) => child.on('close', resolve))
  return { child, exitCode, readOutput: () => output }
}

export async function buildApp(build: Build) {
  const { exitCode, readOutput } = runNext(['build'], { BENCH_BUILD: build })
  if ((await exitCode) !== 0) throw new Error(`next build of the ${build} build failed:\n${readOutput()}`)
}

// The response to the first viewed page, or null while Next doesn't listen yet and refuses it.
async function viewFirstPage(origin: string) {
  try {
    const response = await fetch(`${origin}${VIEWED_PATHS[0]}`, { redirect: 'manual' })
    await response.arrayBuffer()
    return response
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

export async function startServer(build: Build, database: Database, url: string): Promise<Server> {
  const port = await findFreePort()
  const winOverDocuments = WIN_OVER_DOCUMENTS[build]
  const { child, exitCode, readOutput } = runNext(['start', '--hostname', '127.0.0.1', '--port', String(port)], {
    BENCH_BUILD: build,
    BENCH_DATABASE: database,
    DATABASE_URI: url,
    NODE_ENV: 'production',
    ...(winOverDocuments && { BENCH_WIN_OVER_DOCUMENTS: winOverDocuments })
  })
  const origin = `http://127.0.0.1:${port}`
  const server: Server = {
    build,
    origin,
    stop: holdStop(
      async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        await exitCode
      },
      () => child.kill('SIGTERM')
    )
  }
  const deadline = Date.now() + STARTED_WITHIN
  try {
    for (;;) {
      if (child.exitCode !== null) throw new Error(`The ${build} server stopped:\n${readOutput()}`)
      const response = await viewFirstPage(origin)
      if (response?.status === 200) return server
      if (response) {
        throw new Error(`The ${build} server answered ${VIEWED_PATHS[0]} with ${response.status}:\n${readOutput()}`)
      }
      if (Date.now() > deadline) throw new Error(`The ${build} server didn't listen within a minute:\n${readOutput()}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    await server.stop()
    throw error
  }
}
