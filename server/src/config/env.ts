import 'dotenv/config'
import { z } from 'zod'
import { PHONE_REGEX } from '../lib/phone'

/** Accepts `ns`-style boolean strings without z.coerce.boolean's "false" === true trap. */
const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true')

/**
 * Every environment variable the API reads is validated here, once, at boot.
 * A missing/invalid value fails fast instead of surfacing as a 500 later.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173,http://localhost:8081')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    JWT_ISSUER: z.string().min(1).default('borrow-circle'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z.string().min(1).default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),

    // --- Phase 2: OTP + KYC -------------------------------------------------
    /** Server-side pepper for OTP HMACs. Rotating it invalidates in-flight codes. */
    OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),
    /** Pepper for document/phone duplicate-detection hashes. */
    IDENTITY_HASH_PEPPER: z.string().min(32, 'IDENTITY_HASH_PEPPER must be at least 32 characters'),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(300).default(30),
    OTP_MAX_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).max(20).default(5),
    SMS_PROVIDER: z.enum(['mock']).default('mock'),
    KYC_PROVIDER: z.enum(['mock']).default('mock'),
    /**
     * Return the generated OTP in the API response for local testing. Refused
     * outright in production regardless of this flag.
     */
    EXPOSE_DEV_OTP: booleanString('true'),
    /**
     * Phone numbers that are promoted to ADMIN when they first sign up.
     * Comma-separated E.164 (+91XXXXXXXXXX). Keep empty in production.
     */
    ADMIN_PHONES: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((phone) => phone.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      })
    }

    const peppers = [value.OTP_PEPPER, value.IDENTITY_HASH_PEPPER]
    if (new Set(peppers).size !== peppers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IDENTITY_HASH_PEPPER'],
        message: 'OTP_PEPPER and IDENTITY_HASH_PEPPER must differ',
      })
    }

    for (const phone of value.ADMIN_PHONES) {
      if (!PHONE_REGEX.test(phone)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_PHONES'],
          message: `Invalid admin phone: ${phone}. Use E.164 format, e.g. +919876543210`,
        })
      }
    }

    if (value.NODE_ENV === 'production' && value.CORS_ORIGINS.some((o) => o.includes('localhost'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Localhost origins are not allowed in production',
      })
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // Log field names only — never echo secret values.
  console.error('Invalid environment configuration:')
  for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${field}: ${messages?.join('; ')}`)
  }
  console.error('See server/.env.example for the expected values.')
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env

/** Dev OTP exposure is hard-disabled outside development and test. */
export const exposeDevOtp =
  env.EXPOSE_DEV_OTP && env.NODE_ENV !== 'production' && env.SMS_PROVIDER === 'mock'
