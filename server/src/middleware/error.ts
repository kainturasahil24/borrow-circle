import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { logger } from '../lib/logger'
import { env } from '../config/env'

/** Operational error with a stable machine-readable code. */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: unknown

  constructor(statusCode: number, message: string, code = 'APP_ERROR', details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    Error.captureStackTrace?.(this, AppError)
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, `Route ${req.method} ${req.originalUrl} not found`, 'NOT_FOUND'))
}

type ErrorBody = {
  error: {
    code: string
    message: string
    details?: unknown
    requestId?: string
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // pino-http attaches a request id; read it defensively so typing stays local.
  const rawId = (req as unknown as { id?: unknown }).id
  const requestId = typeof rawId === 'string' ? rawId : undefined

  const send = (status: number, body: ErrorBody) => {
    res.status(status).json(body)
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error({ err, requestId }, 'request failed')
    return send(err.statusCode, {
      error: { code: err.code, message: err.message, details: err.details, requestId },
    })
  }

  // Validation errors from zod-based route schemas.
  if (err instanceof ZodError) {
    return send(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
        requestId,
      },
    })
  }

  // Malformed JSON from express.json().
  if (err instanceof SyntaxError && 'body' in err) {
    return send(400, {
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId },
    })
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return send(409, {
        error: { code: 'CONFLICT', message: 'Resource already exists', requestId },
      })
    }
    if (err.code === 'P2025') {
      return send(404, {
        error: { code: 'NOT_FOUND', message: 'Resource not found', requestId },
      })
    }
    // Serialisable transaction conflict / deadlock: safe for the client to retry.
    if (err.code === 'P2034') {
      return send(409, {
        error: {
          code: 'CONFLICT_RETRY',
          message: 'The request conflicted with another change. Please try again.',
          requestId,
        },
      })
    }
  }

  // Unknown error: log the stack, return a generic message.
  logger.error({ err, requestId }, 'unhandled error')
  return send(500, {
    error: {
      code: 'INTERNAL_ERROR',
      message:
        env.NODE_ENV === 'production' ? 'Something went wrong' : String((err as Error)?.message),
      requestId,
    },
  })
}
