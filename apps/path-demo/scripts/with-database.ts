import { spawn } from 'node:child_process'

import { MongoMemoryReplSet } from 'mongodb-memory-server'

/**
 * Runs a command against a fresh MongoDB, a one-node replica set so Payload runs each save in a
 * transaction, which the plugin works without too, and stops MongoDB when the command ends. The demo
 * seeds the empty database itself.
 */
const [command, ...args] = process.argv.slice(2)
if (!command) {
  throw new Error('Name the command to run, such as: with-database.ts next dev')
}

const replicaSet = await MongoMemoryReplSet.create({ instanceOpts: [{ storageEngine: 'wiredTiger' }], replSet: { count: 1 } })
const child = spawn(command, args, { env: { ...process.env, DATABASE_URI: replicaSet.getUri('demo') }, stdio: 'inherit' })

const stop = async (code: number) => {
  await replicaSet.stop()
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}
// A command that cannot start, such as a missing one, emits an error and no exit. Close follows
// every end: an exit, a signal or that error, which gives it a negative code.
child.on('error', (error) => console.error(error.message))
child.on('close', (code) => void stop(code !== null && code >= 0 ? code : 1))
