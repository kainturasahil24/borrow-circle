import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { AppError } from '../middleware/error'
import { parseDurationSeconds } from './time'

const AUDIENCE = 'borrow-circle-api'
const ALGORITHM = 'HS256'

export type AccessTokenClaims = {
  sub: string
  /** Login-session family; lets an admin revoke a whole session. */
  sid: string
  typ: 'access'
}

/**
 * Access tokens stay short-lived and carry only identity + session id.
 * Role, status and KYC state are read from the database on every request so a
 * suspension or KYC change takes effect immediately.
 */
export function signAccessToken(input: { userId: string; sessionId: string }): {
  token: string
  expiresInSeconds: number
} {
  const expiresInSeconds = parseDurationSeconds(env.ACCESS_TOKEN_TTL)
  const token = jwt.sign({ typ: 'access', sid: input.sessionId }, env.JWT_ACCESS_SECRET, {
    subject: input.userId,
    issuer: env.JWT_ISSUER,
    audience: AUDIENCE,
    algorithm: ALGORITHM,
    expiresIn: expiresInSeconds,
  })
  return { token, expiresInSeconds }
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    })

    if (
      typeof payload === 'string' ||
      payload.typ !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw new Error('Unexpected access-token claims')
    }

    return { sub: payload.sub, sid: payload.sid, typ: 'access' }
  } catch {
    // Never distinguish expired from malformed to callers.
    throw new AppError(401, 'Invalid or expired access token', 'INVALID_TOKEN')
  }
}
