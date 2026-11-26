import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env'

/**
 * OTP codes are short and low-entropy, so they are stored only as an HMAC
 * keyed with OTP_PEPPER. A leaked database alone cannot brute-force codes.
 */
export function hashOtp(phone: string, code: string): string {
  return createHmac('sha256', env.OTP_PEPPER).update(`${phone}:${code}`).digest('hex')
}

/**
 * Duplicate/fraud detection for identity numbers. The document type is part of
 * the message so the same digits in two different documents never collide.
 */
export function hashIdentity(kind: string, normalizedNumber: string): string {
  return createHmac('sha256', env.IDENTITY_HASH_PEPPER)
    .update(`${kind}:${normalizedNumber}`)
    .digest('hex')
}

/** Refresh tokens are 384-bit random values; a plain SHA-256 is sufficient. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

/** Cryptographically random 6-digit code, uniformly distributed. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!left || !right) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
