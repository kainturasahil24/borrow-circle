import rateLimit from 'express-rate-limit'
import { env } from '../config/env'
import { AppError } from './error'

const skipInTests = () => env.NODE_ENV === 'test'

/** OTP send: 10 requests / 15 min / IP, on top of the per-phone DB limits. */
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'Too many code requests. Try again in a few minutes.', 'RATE_LIMITED'))
  },
})

/** OTP verify: 30 attempts / 15 min / IP. Per-challenge attempts are capped in the DB. */
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'Too many attempts. Try again in a few minutes.', 'RATE_LIMITED'))
  },
})

/** Token refresh / logout: generous, but stops refresh-token guessing. */
export const tokenLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'Too many requests. Slow down.', 'RATE_LIMITED'))
  },
})
