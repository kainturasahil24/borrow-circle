import type { Request, RequestHandler } from 'express'
import type { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { verifyAccessToken } from '../lib/jwt'
import { AppError } from './error'
import { asyncHandler } from './async'

/** Narrows req.auth for handlers mounted behind `authenticate`. */
export function authContext(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) {
    throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED')
  }
  return req.auth
}

/**
 * Verifies the bearer token, then loads the user so suspension, deletion and
 * KYC changes apply immediately rather than when the access token expires.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED')
  }

  const claims = verifyAccessToken(header.slice('Bearer '.length).trim())

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      phone: true,
      role: true,
      status: true,
      kycStatus: true,
      deletedAt: true,
    },
  })

  if (!user || user.deletedAt) {
    throw new AppError(401, 'This account is no longer available', 'UNAUTHENTICATED')
  }
  if (user.status === 'BANNED') {
    throw new AppError(403, 'This account has been banned', 'ACCOUNT_BANNED')
  }
  if (user.status === 'SUSPENDED') {
    throw new AppError(403, 'This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED')
  }

  req.auth = {
    userId: user.id,
    role: user.role,
    status: user.status,
    kycStatus: user.kycStatus,
    phone: user.phone,
    sessionId: claims.sid,
  }
  next()
})

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth
    if (!auth) return next(new AppError(401, 'Authentication required', 'UNAUTHENTICATED'))
    if (!roles.includes(auth.role)) {
      return next(new AppError(403, 'You do not have access to this resource', 'FORBIDDEN'))
    }
    next()
  }
}

/** For routes that create contracts or move money (later phases). */
export function requireVerifiedKyc(): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth
    if (!auth) return next(new AppError(401, 'Authentication required', 'UNAUTHENTICATED'))
    if (auth.kycStatus !== 'VERIFIED') {
      return next(
        new AppError(403, 'Complete KYC verification to continue', 'KYC_REQUIRED'),
      )
    }
    next()
  }
}
