import { PrismaClient } from '@prisma/client'
import { env } from '../config/env'

/**
 * Single Prisma client per process. The global cache keeps tsx watch from
 * opening a new pool on every reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    errorFormat: 'minimal',
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
