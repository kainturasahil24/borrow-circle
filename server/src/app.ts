import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { env } from './config/env'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { AppError, errorHandler, notFoundHandler } from './middleware/error'
import { apiRouter } from './routes'

export function createApp(): express.Express {
  const app = express()

  app.disable('x-powered-by')
  // Behind a proxy/load balancer in production, so rate limiting sees real IPs.
  app.set('trust proxy', 1)

  app.use(helmet())
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin/native requests (no Origin header) and allow-listed web origins.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true)
          return
        }
        callback(new AppError(403, 'Origin not allowed', 'CORS_ORIGIN_DENIED'))
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      maxAge: 600,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }))

  // Liveness: process is up. Used by container orchestrators.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })
  })

  // Readiness: the API can serve traffic (database reachable).
  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ status: 'ready', database: 'up' })
    } catch (error) {
      logger.error({ err: error }, 'readiness check failed')
      res.status(503).json({ status: 'degraded', database: 'down' })
    }
  })

  // Global rate limit for API routes. Stricter per-route limits arrive with auth.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again shortly' } },
    }),
  )

  app.get('/api/v1', (_req, res) => {
    res.json({
      data: {
        name: 'Borrow Circle API',
        version: 'v1',
        phase: 2,
      },
    })
  })

  app.use('/api/v1', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
