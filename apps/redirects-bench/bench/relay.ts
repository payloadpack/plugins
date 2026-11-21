import { Worker } from 'node:worker_threads'

import type { RelayWorkerData } from './relay-worker.ts'

// Each way, so a round trip to the database takes 5 ms more.
export const DELAY_EACH_WAY = 2.5

export type Relay = {
  port: number
  // The chunks clients have sent through the relay to the database so far.
  readSentToDatabase: () => number
  stop: () => Promise<void>
}

/**
 * A TCP relay in front of a database port, which delays every chunk DELAY_EACH_WAY in each
 * direction, in order, as if the database were on another machine. It runs in a worker thread, so its
 * timers never share an event loop with the requests the bench times.
 */
export async function startRelay(targetPort: number): Promise<Relay> {
  const sentToDatabase = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const workerData: RelayWorkerData = { delayEachWay: DELAY_EACH_WAY, sentToDatabase, targetPort }
  const worker = new Worker(new URL('./relay-worker.ts', import.meta.url), { workerData })
  const port = await new Promise<number>((resolve, reject) => {
    worker.once('message', (listeningPort: null | number) =>
      listeningPort ? resolve(listeningPort) : reject(new Error('The relay found no port to listen on'))
    )
    worker.once('error', reject)
  })
  return {
    port,
    readSentToDatabase: () => Atomics.load(sentToDatabase, 0),
    stop: async () => {
      await worker.terminate()
    }
  }
}
