import { createConnection, createServer, type Socket } from 'node:net'
import { parentPort, workerData } from 'node:worker_threads'

export type RelayWorkerData = {
  delayEachWay: number
  // Index 0 counts the chunks sent to the database.
  sentToDatabase: Int32Array
  targetPort: number
}

const { delayEachWay, sentToDatabase, targetPort } = workerData as RelayWorkerData

// Node's timers are whole milliseconds, and the system wakes a sleeping thread for one up to several
// milliseconds late, so while a chunk waits the worker keeps its event loop turning with setImmediate,
// which keeps a core busy then.
function delayInOrder(from: Socket, to: Socket, onChunk?: () => void) {
  const queuedChunks: { chunk: Buffer; due: number }[] = []
  let isWriteScheduled = false
  const writeDue = () => {
    isWriteScheduled = false
    while (queuedChunks.length > 0 && queuedChunks[0]!.due <= performance.now()) to.write(queuedChunks.shift()!.chunk)
    schedule()
  }
  const schedule = () => {
    if (isWriteScheduled || queuedChunks.length === 0) return
    isWriteScheduled = true
    setImmediate(writeDue)
  }
  from.on('data', (chunk: Buffer) => {
    onChunk?.()
    queuedChunks.push({ chunk, due: performance.now() + delayEachWay })
    schedule()
  })
}

const server = createServer({ noDelay: true }, (client) => {
  const database = createConnection({ host: '127.0.0.1', noDelay: true, port: targetPort })
  delayInOrder(client, database, () => Atomics.add(sentToDatabase, 0, 1))
  delayInOrder(database, client)
  for (const [socket, other] of [
    [client, database],
    [database, client]
  ] as const) {
    socket.on('error', () => other.destroy())
    socket.on('close', () => other.destroy())
  }
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  parentPort!.postMessage(typeof address === 'object' && address ? address.port : null)
})
