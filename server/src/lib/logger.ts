import pino from 'pino'
import { env } from '../config/env'

/**
 * Structured JSON logs in test/production, pretty logs in development.
 * PII, OTPs and tokens must never appear in logs: redaction is a safety net,
 * not a substitute for not logging them in the first place.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'borrow-circle-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.otp',
      '*.aadhaar',
      '*.pan',
      '*.aadhaarNumber',
      '*.panNumber',
      '*.mfaSecret',
      '*.signature',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
        }
      : undefined,
})
