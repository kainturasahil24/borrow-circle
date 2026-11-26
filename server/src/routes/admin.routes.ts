import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async'
import { authenticate, authContext, requireRole } from '../middleware/auth'
import {
  decideKycDocument,
  getKycDocumentForAdmin,
  listKycQueue,
} from '../services/kyc.service'

const queueQuery = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'NOT_STARTED']).default('PENDING'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

const idParams = z.object({ id: z.string().uuid('Invalid document id') })

const decisionBody = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    /** Required when rejecting; enforced again in the service. */
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .strict()

export const adminRouter = Router()

// Every admin route requires a valid session AND the ADMIN role.
adminRouter.use(authenticate, requireRole('ADMIN'))

adminRouter.get(
  '/kyc',
  asyncHandler(async (req, res) => {
    const query = queueQuery.parse(req.query)
    const result = await listKycQueue(query)
    res.status(200).json({ ...result, status: query.status })
  }),
)

adminRouter.get(
  '/kyc/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParams.parse(req.params)
    const document = await getKycDocumentForAdmin(id)
    res.status(200).json({ document })
  }),
)

adminRouter.post(
  '/kyc/:id/decision',
  asyncHandler(async (req, res) => {
    const { id } = idParams.parse(req.params)
    const body = decisionBody.parse(req.body)
    const result = await decideKycDocument({
      adminId: authContext(req).userId,
      documentId: id,
      decision: body.decision,
      reason: body.reason,
      ipAddress: req.ip,
    })
    res.status(200).json(result)
  }),
)
