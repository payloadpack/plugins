import { createServer } from 'node:net'

export const findFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port'))))
    })
  })
