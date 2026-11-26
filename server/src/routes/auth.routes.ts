import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async'
import { authenticate, authContext } from '../middleware/auth'
import { otpRequestLimiter, otpVerifyLimiter, tokenLimiter } from '../middleware/rateLimit'
import {
  listSessions,
  requestOtp,
  revokeAllSessions,
  revokeSession,
  revokeSessionById,
  rotateRefreshToken,
  verifyOtp,
} from '../services/auth.service'

const phone = z.string().trim().min(10, 'Enter your mobile number').max(16)

const device = z.object({
  fingerprint: z.string().min(8).max(200),
  platform: z.enum(['ios', 'android', 'web', 'unknown']).optional(),
  appVersion: z.string().max(40).optional(),
  pushToken: z.string().max(4096).optional(),
})

const refreshToken = z.string().min(20, 'refreshToken is required').max(200)

const requestOtpBody = z.object({ phone })
const verifyOtpBody = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  device: device.optional(),
})
const refreshBody = z.object({ refreshToken })
const logoutBody = z.object({ refreshToken })

export const authRouter = Router()

/** Send (or re-send) a login code. Same response for new and existing users. */
authRouter.post(
  '/otp/request',
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const body = requestOtpBody.parse(req.body)
    const otp = await requestOtp({ phone: body.phone, ipAddress: req.ip })
    res.status(200).json({ otp })
  }),
)

/** Verify the code, creating the account on first login and returning a session. */
authRouter.post(
  '/otp/verify',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const body = verifyOtpBody.parse(req.body)
    const session = await verifyOtp({
      phone: body.phone,
      code: body.code,
      device: body.device,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    })
    res.status(200).json(session)
  }),
)

/** Exchange a refresh token for a new pair. Rotation + reuse detection. */
authRouter.post(
  '/refresh',
  tokenLimiter,
  asyncHandler(async (req, res) => {
    const body = refreshBody.parse(req.body)
    const session = await rotateRefreshToken({
      refreshToken: body.refreshToken,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    })
    res.status(200).json(session)
  }),
)

/** Revoke the current session. Idempotent, works with an expired access token. */
authRouter.post(
  '/logout',
  tokenLimiter,
  asyncHandler(async (req, res) => {
    const body = logoutBody.parse(req.body)
    await revokeSession(body.refreshToken)
    res.status(200).json({ revoked: true })
  }),
)

authRouter.get(
  '/sessions',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = authContext(req)
    const sessions = await listSessions(auth.userId, auth.sessionId)
    res.status(200).json({ data: sessions, currentSessionId: auth.sessionId })
  }),
)

authRouter.delete(
  '/sessions/:familyId',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = authContext(req)
    const { familyId } = z.object({ familyId: z.string().uuid() }).parse(req.params)
    await revokeSessionById(auth.userId, familyId)
    res.status(200).json({ revoked: true })
  }),
)

/** Sign out of every device (also used after a password/phone change later). */
authRouter.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = authContext(req)
    const revokedSessions = await revokeAllSessions(auth.userId, {
      reason: 'AUTH_LOGOUT_ALL',
      ipAddress: req.ip,
    })
    res.status(200).json({ revokedSessions })
  }),
)
