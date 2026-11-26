import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async'
import { authenticate, authContext } from '../middleware/auth'
import { getProfile, requestDeletion, cancelDeletion, updateProfile } from '../services/profile.service'
import { getMyKyc, submitKycDocument } from '../services/kyc.service'

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()

const profileBody = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(254).nullable().optional(),
    photoUrl: z.string().trim().url('Enter a valid image URL').max(500).nullable().optional(),
    addressLine: optionalText(250),
    city: optionalText(80),
    state: optionalText(80),
    pincode: z
      .string()
      .regex(/^\d{6}$/, 'Pincode must be 6 digits')
      .nullable()
      .optional(),
  })
  .strict()

/** Image keys are opaque storage keys created by the upload step, never URLs. */
const imageKey = z
  .string()
  .trim()
  .max(300)
  .regex(/^kyc\/[A-Za-z0-9/_.-]+$/, 'Image key must start with kyc/')
  .optional()

const kycDocumentBody = z
  .object({
    type: z.enum(['AADHAAR', 'PAN', 'DRIVING_LICENCE']),
    number: z.string().trim().min(4, 'Enter the document number').max(32),
    /** Version of the KYC consent text the user accepted. */
    consentVersion: z.string().trim().min(1).max(32),
    holderName: z.string().trim().min(2).max(100).optional(),
    frontImageKey: imageKey,
    backImageKey: imageKey,
    selfieImageKey: imageKey,
  })
  .strict()

export const meRouter = Router()

meRouter.use(authenticate)

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await getProfile(authContext(req).userId)
    res.status(200).json({ user })
  }),
)

meRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = profileBody.parse(req.body)
    const user = await updateProfile(authContext(req).userId, body, req.ip)
    res.status(200).json({ user })
  }),
)

meRouter.get(
  '/kyc',
  asyncHandler(async (req, res) => {
    const kyc = await getMyKyc(authContext(req).userId)
    res.status(200).json(kyc)
  }),
)

meRouter.post(
  '/kyc/documents',
  asyncHandler(async (req, res) => {
    const auth = authContext(req)
    const body = kycDocumentBody.parse(req.body)
    const result = await submitKycDocument({
      userId: auth.userId,
      type: body.type,
      number: body.number,
      consentVersion: body.consentVersion,
      holderName: body.holderName,
      frontImageKey: body.frontImageKey,
      backImageKey: body.backImageKey,
      selfieImageKey: body.selfieImageKey,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    })
    res.status(201).json(result)
  }),
)

/** Schedule erasure after a grace period (DPDP right to erasure). */
meRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const deletion = await requestDeletion(authContext(req).userId, req.ip)
    res.status(202).json({ deletion })
  }),
)

meRouter.post(
  '/deletion/cancel',
  asyncHandler(async (req, res) => {
    const deletion = await cancelDeletion(authContext(req).userId, req.ip)
    res.status(200).json({ deletion })
  }),
)
