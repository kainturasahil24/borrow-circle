import { randomUUID } from 'node:crypto'
import type { Prisma, User } from '@prisma/client'
import { env, exposeDevOtp } from '../config/env'
import { prisma } from '../lib/prisma'
import {
  generateOtp,
  generateRefreshToken,
  hashOtp,
  hashRefreshToken,
  safeEqualHex,
} from '../lib/crypto'
import { isValidPhone, maskPhone, normalizePhone } from '../lib/phone'
import { signAccessToken } from '../lib/jwt'
import { recordAudit } from '../lib/audit'
import { logger } from '../lib/logger'
import { AppError } from '../middleware/error'
import { smsProvider } from './providers/sms'
import { publicUser, type PublicUser } from './serializers'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export type DeviceInput = {
  fingerprint: string
  platform?: string
  appVersion?: string
  pushToken?: string
}

export type RequestOtpInput = {
  phone: string
  ipAddress?: string
}

export type VerifyOtpInput = {
  phone: string
  code: string
  device?: DeviceInput
  ipAddress?: string
  userAgent?: string
}

export type SessionPayload = {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: number
  user: PublicUser
  isNewUser: boolean
}

export type RequestOtpResult = {
  sent: true
  expiresInSeconds: number
  resendAfterSeconds: number
  devCode?: string
}

function assertPhone(phone: string): string {
  const normalized = normalizePhone(phone)
  if (!isValidPhone(normalized)) {
    throw new AppError(400, 'Enter a valid Indian mobile number', 'INVALID_PHONE')
  }
  return normalized
}

function refreshTokenExpiry(now: Date): Date {
  return new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS)
}

function createSession(
  tx: Prisma.TransactionClient,
  input: {
    userId: string
    familyId: string
    ipAddress?: string
    userAgent?: string
    deviceId?: string | null
  },
): Promise<string> {
  const token = generateRefreshToken()
  return tx.refreshToken
    .create({
      data: {
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: hashRefreshToken(token),
        deviceId: input.deviceId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: refreshTokenExpiry(new Date()),
      },
    })
    .then(() => token)
}

/**
 * Creates (or supersedes) a 6-digit OTP challenge.
 *
 * Anti-abuse: per-IP limiter in the route, plus per-phone cooldown and hourly
 * cap here. The response shape is identical for new and existing accounts, so
 * this endpoint cannot be used to enumerate users.
 */
export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  const phone = assertPhone(input.phone)
  const now = new Date()

  const [lastChallenge, recentCount] = await Promise.all([
    prisma.otpChallenge.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      select: { sentAt: true },
    }),
    prisma.otpChallenge.count({
      where: { phone, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    }),
  ])

  if (recentCount >= env.OTP_MAX_REQUESTS_PER_HOUR) {
    throw new AppError(
      429,
      'Too many codes requested for this number. Try again later.',
      'OTP_RATE_LIMITED',
    )
  }

  if (lastChallenge) {
    const elapsedSeconds = Math.floor((now.getTime() - lastChallenge.sentAt.getTime()) / 1_000)
    if (elapsedSeconds < env.OTP_RESEND_COOLDOWN_SECONDS) {
      const retryAfterSeconds = env.OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds
      throw new AppError(
        429,
        `Please wait ${retryAfterSeconds}s before requesting another code`,
        'OTP_COOLDOWN',
        { retryAfterSeconds },
      )
    }
  }

  const code = generateOtp()
  const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1_000)

  await prisma.$transaction([
    // Any earlier unconsumed code is superseded; only the newest one works.
    prisma.otpChallenge.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.otpChallenge.create({
      data: {
        phone,
        codeHash: hashOtp(phone, code),
        maxAttempts: env.OTP_MAX_ATTEMPTS,
        requestIp: input.ipAddress ?? null,
        expiresAt,
      },
    }),
  ])

  await smsProvider.sendOtp({
    phone,
    template: 'LOGIN_OTP',
    code,
    expiresInSeconds: env.OTP_TTL_SECONDS,
  })

  return {
    sent: true,
    expiresInSeconds: env.OTP_TTL_SECONDS,
    resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    ...(exposeDevOtp ? { devCode: code } : {}),
  }
}

/**
 * Verifies the latest OTP, creates the account on first login, registers the
 * device, starts a refresh-token family and returns a session.
 */
export async function verifyOtp(input: VerifyOtpInput): Promise<SessionPayload> {
  const phone = assertPhone(input.phone)
  const now = new Date()

  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  })

  if (!challenge) {
    throw new AppError(400, 'This code has expired. Request a new one.', 'OTP_EXPIRED')
  }

  // Atomic attempt counter: concurrent guesses cannot share an attempt slot.
  const attempt = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
    data: { attempts: { increment: 1 } },
  })

  if (attempt.count !== 1) {
    throw new AppError(
      429,
      'Too many incorrect attempts. Request a new code.',
      'OTP_ATTEMPTS_EXCEEDED',
    )
  }

  if (!safeEqualHex(challenge.codeHash, hashOtp(phone, input.code))) {
    const attemptsUsed = challenge.attempts + 1
    logger.warn({ phone: maskPhone(phone) }, 'incorrect OTP attempt')
    throw new AppError(400, 'Incorrect code', 'OTP_INCORRECT', {
      attemptsRemaining: Math.max(challenge.maxAttempts - attemptsUsed, 0),
    })
  }

  const familyId = randomUUID()
  const device = input.device

  const result = await prisma.$transaction(async (tx) => {
    // Consume only once; a concurrent request that lost the race gets a clear error.
    const consumed = await tx.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    })
    if (consumed.count !== 1) {
      throw new AppError(409, 'This code was already used. Request a new one.', 'OTP_ALREADY_USED')
    }

    const existing = await tx.user.findUnique({ where: { phone } })
    if (existing?.deletedAt) {
      throw new AppError(403, 'This account has been deleted', 'ACCOUNT_DELETED')
    }
    if (existing && existing.status !== 'ACTIVE') {
      throw new AppError(403, 'This account is not active. Contact support.', 'ACCOUNT_BLOCKED')
    }

    const promotedToAdmin = env.ADMIN_PHONES.includes(phone)
    let user: User
    let isNewUser = false

    if (!existing) {
      user = await tx.user.create({
        data: {
          phone,
          phoneVerifiedAt: now,
          lastLoginAt: now,
          role: promotedToAdmin ? 'ADMIN' : 'USER',
        },
      })
      isNewUser = true
    } else {
      const roleChanged = promotedToAdmin && existing.role !== 'ADMIN'
      user = await tx.user.update({
        where: { id: existing.id },
        data: {
          phoneVerifiedAt: existing.phoneVerifiedAt ?? now,
          lastLoginAt: now,
          ...(roleChanged ? { role: 'ADMIN' as const } : {}),
        },
      })
      if (roleChanged) {
        await recordAudit(tx, {
          actorType: 'SYSTEM',
          actorId: user.id,
          action: 'AUTH_ADMIN_PROMOTED',
          entityType: 'User',
          entityId: user.id,
          ipAddress: input.ipAddress,
        })
      }
    }

    let deviceId: string | null = null
    if (device) {
      const saved = await tx.device.upsert({
        where: { userId_fingerprint: { userId: user.id, fingerprint: device.fingerprint } },
        create: {
          userId: user.id,
          fingerprint: device.fingerprint,
          platform: device.platform ?? null,
          appVersion: device.appVersion ?? null,
          pushToken: device.pushToken ?? null,
        },
        update: {
          lastSeenAt: now,
          ...(device.platform ? { platform: device.platform } : {}),
          ...(device.appVersion ? { appVersion: device.appVersion } : {}),
          ...(device.pushToken ? { pushToken: device.pushToken } : {}),
        },
      })
      deviceId = saved.id
    }

    const refreshToken = await createSession(tx, {
      userId: user.id,
      familyId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceId,
    })

    await recordAudit(tx, {
      actorType: isNewUser ? 'SYSTEM' : 'USER',
      actorId: user.id,
      action: isNewUser ? 'AUTH_SIGNUP' : 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      metadata: { method: 'phone_otp', newUser: isNewUser },
      ipAddress: input.ipAddress,
    })

    return { user, refreshToken, isNewUser }
  })

  const { token: accessToken, expiresInSeconds } = signAccessToken({
    userId: result.user.id,
    sessionId: familyId,
  })

  return {
    accessToken,
    refreshToken: result.refreshToken,
    tokenType: 'Bearer',
    expiresIn: expiresInSeconds,
    user: publicUser(result.user),
    isNewUser: result.isNewUser,
  }
}

/**
 * Rotates a refresh token. Reuse of an already-rotated token is treated as
 * theft: the whole family is revoked and the event is audited.
 */
export async function rotateRefreshToken(input: {
  refreshToken: string
  ipAddress?: string
  userAgent?: string
}): Promise<Omit<SessionPayload, 'isNewUser'>> {
  const tokenHash = hashRefreshToken(input.refreshToken)
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } })

  if (!existing) {
    throw new AppError(401, 'Session expired. Please sign in again.', 'REFRESH_INVALID')
  }

  if (existing.usedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await recordAudit(tx, {
        actorType: 'SYSTEM',
        actorId: existing.userId,
        action: 'AUTH_REFRESH_REUSE_DETECTED',
        entityType: 'RefreshToken',
        entityId: existing.id,
        metadata: { familyId: existing.familyId },
        ipAddress: input.ipAddress,
      })
    })
    logger.warn({ userId: existing.userId }, 'refresh token reuse detected; family revoked')
    throw new AppError(
      401,
      'Session reuse detected. Please sign in again.',
      'REFRESH_REUSE_DETECTED',
    )
  }

  // A plain logout revokes the token; that is not a theft signal.
  if (existing.revokedAt) {
    throw new AppError(401, 'Session ended. Please sign in again.', 'REFRESH_INVALID')
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, 'Session expired. Please sign in again.', 'REFRESH_EXPIRED')
  }

  const user = await prisma.user.findUnique({ where: { id: existing.userId } })
  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    throw new AppError(401, 'Session is no longer valid. Please sign in again.', 'REFRESH_INVALID')
  }

  const now = new Date()
  const nextToken = generateRefreshToken()
  const nextTokenHash = hashRefreshToken(nextToken)

  await prisma.$transaction(async (tx) => {
    // Single-use: only one concurrent rotation can win this update.
    const consumed = await tx.refreshToken.updateMany({
      where: { id: existing.id, usedAt: null, revokedAt: null },
      data: { usedAt: now, revokedAt: now, replacedByTokenHash: nextTokenHash },
    })
    if (consumed.count !== 1) {
      throw new AppError(
        409,
        'Session was already refreshed. Retry with the latest token.',
        'REFRESH_RACE',
      )
    }

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        familyId: existing.familyId,
        tokenHash: nextTokenHash,
        deviceId: existing.deviceId,
        ipAddress: input.ipAddress ?? existing.ipAddress,
        userAgent: input.userAgent ?? existing.userAgent,
        expiresAt: refreshTokenExpiry(now),
      },
    })
    await recordAudit(tx, {
      actorType: 'USER',
      actorId: user.id,
      action: 'AUTH_TOKEN_REFRESHED',
      entityType: 'RefreshToken',
      entityId: existing.id,
      ipAddress: input.ipAddress,
    })
  })

  const { token: accessToken, expiresInSeconds } = signAccessToken({
    userId: user.id,
    sessionId: existing.familyId,
  })

  return {
    accessToken,
    refreshToken: nextToken,
    tokenType: 'Bearer',
    expiresIn: expiresInSeconds,
    user: publicUser(user),
  }
}

/** Revokes the family that owns this refresh token. Idempotent, never leaks existence. */
export async function revokeSession(refreshToken: string): Promise<void> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    select: { familyId: true, userId: true },
  })
  if (!existing) return

  await prisma.$transaction(async (tx) => {
    const result = await tx.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (result.count === 0) return
    await recordAudit(tx, {
      actorType: 'USER',
      actorId: existing.userId,
      action: 'AUTH_LOGOUT',
      entityType: 'RefreshToken',
      metadata: { familyId: existing.familyId },
    })
  })
}

export async function revokeAllSessions(
  userId: string,
  options: { reason: string; ipAddress?: string; keepFamilyId?: string },
): Promise<number> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const result = await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(options.keepFamilyId ? { familyId: { not: options.keepFamilyId } } : {}),
      },
      data: { revokedAt: now },
    })
    await recordAudit(tx, {
      actorType: 'USER',
      actorId: userId,
      action: options.reason,
      entityType: 'User',
      entityId: userId,
      metadata: { revokedSessions: result.count },
      ipAddress: options.ipAddress,
    })
    return result.count
  })
}

export async function revokeSessionById(userId: string, familyId: string): Promise<void> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) {
    throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND')
  }
}

export async function listSessions(userId: string, currentFamilyId: string) {
  const tokens = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      familyId: true,
      deviceId: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
  })

  const latestByFamily = new Map<string, (typeof tokens)[number]>()
  for (const token of tokens) {
    if (!latestByFamily.has(token.familyId)) latestByFamily.set(token.familyId, token)
  }

  return [...latestByFamily.entries()].map(([familyId, token]) => ({
    id: familyId,
    deviceId: token.deviceId,
    ipAddress: token.ipAddress,
    userAgent: token.userAgent,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    current: familyId === currentFamilyId,
  }))
}
