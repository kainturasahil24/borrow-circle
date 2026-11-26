import { createApp } from './app'
import { env } from './config/env'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'

const app = createApp()

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Borrow Circle API listening')
})

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')

  // Force exit if connections refuse to drain.
  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'error closing HTTP server')
    try {
      await prisma.$disconnect()
    } catch (disconnectError) {
      logger.error({ err: disconnectError }, 'error disconnecting Prisma')
    }
    process.exit(error ? 1 : 0)
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection')
  void shutdown('unhandledRejection')
})

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception')
  void shutdown('uncaughtException')
})
