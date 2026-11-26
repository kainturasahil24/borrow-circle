import type { KycDocument, KycDocumentType, KycStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { hashIdentity } from '../lib/crypto'
import { maskPhone } from '../lib/phone'
import { recordAudit } from '../lib/audit'
import { AppError } from '../middleware/error'
import { kycProvider } from './providers/kyc'
import { publicKycDocument } from './serializers'

const DOCUMENT_RULES: Record<KycDocumentType, { label: string; pattern: RegExp; message: string }> = {
  AADHAAR: {
    label: 'Aadhaar number',
    pattern: /^[2-9]\d{11}$/,
    message: 'Aadhaar must be 12 digits and cannot start with 0 or 1',
  },
  PAN: {
    label: 'PAN',
    pattern: /^[A-Z]{5}\d{4}[A-Z]$/,
    message: 'PAN must look like ABCDE1234F',
  },
  DRIVING_LICENCE: {
    label: 'Driving licence number',
    pattern: /^[A-Z0-9]{8,16}$/,
    message: 'Driving licence must be 8-16 letters and digits',
  },
}

function normalizeDocumentNumber(type: KycDocumentType, raw: string): string {
  const compact = raw.replace(/[\s-]/g, '').toUpperCase()
  if (!DOCUMENT_RULES[type].pattern.test(compact)) {
    throw new AppError(400, DOCUMENT_RULES[type].message, 'INVALID_DOCUMENT_NUMBER', {
      field: `${type.toLowerCase()}_number`,
    })
  }
  return compact
}

type UserKycSummary = { status: KycStatus; verifiedAt: Date | null }

/**
 * User-level KYC status derived from documents:
 * verified Aadhaar → VERIFIED; else pending → PENDING; else rejected → REJECTED.
 */
async function deriveUserKycStatus(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<UserKycSummary> {
  const documents = await tx.kycDocument.findMany({
    where: { userId, purgedAt: null },
    select: { type: true, status: true, verifiedAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const verifiedAadhaar = documents.find(
    (doc) => doc.type === 'AADHAAR' && doc.status === 'VERIFIED',
  )
  if (verifiedAadhaar) {
    return { status: 'VERIFIED', verifiedAt: verifiedAadhaar.verifiedAt }
  }
  if (documents.some((doc) => doc.status === 'PENDING')) {
    return { status: 'PENDING', verifiedAt: null }
  }
  if (documents.some((doc) => doc.status === 'REJECTED')) {
    return { status: 'REJECTED', verifiedAt: null }
  }
  return { status: 'NOT_STARTED', verifiedAt: null }
}

async function syncUserKycStatus(tx: Prisma.TransactionClient, userId: string) {
  const summary = await deriveUserKycStatus(tx, userId)
  await tx.user.update({
    where: { id: userId },
    data: { kycStatus: summary.status, kycVerifiedAt: summary.verifiedAt },
  })
  return summary
}

export type SubmitKycInput = {
  userId: string
  type: KycDocumentType
  number: string
  consentVersion: string
  holderName?: string
  frontImageKey?: string
  backImageKey?: string
  selfieImageKey?: string
  ipAddress?: string
  userAgent?: string
}

/**
 * KYC submission:
 *  - the full number is validated, sent to the provider and discarded; only
 *    the last 4 digits plus an HMAC are stored;
 *  - consent is recorded as an immutable row alongside the document;
 *  - a number already used by another account is rejected.
 */
export async function submitKycDocument(input: SubmitKycInput) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, kycStatus: true },
  })
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND')

  const existingOfType = await prisma.kycDocument.findFirst({
    where: { userId: user.id, type: input.type, purgedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  })
  if (existingOfType?.status === 'VERIFIED') {
    throw new AppError(409, 'This document is already verified', 'DOCUMENT_ALREADY_VERIFIED')
  }
  if (existingOfType?.status === 'PENDING') {
    throw new AppError(409, 'This document is already under review', 'DOCUMENT_PENDING_REVIEW')
  }

  const number = normalizeDocumentNumber(input.type, input.number)
  const holderName = input.holderName ?? user.name
  if (!holderName) {
    throw new AppError(400, 'Add your full name to your profile before KYC', 'PROFILE_INCOMPLETE')
  }

  const numberHash = hashIdentity(input.type, number)
  const duplicate = await prisma.kycDocument.findFirst({
    where: {
      numberHash,
      purgedAt: null,
      userId: { not: user.id },
      status: { in: ['PENDING', 'VERIFIED'] },
    },
    select: { id: true },
  })
  if (duplicate) {
    // Deliberately does not reveal which account holds the document.
    throw new AppError(
      409,
      'This document is already linked to another account. Contact support if this is a mistake.',
      'DOCUMENT_IN_USE',
    )
  }

  const verification = await kycProvider.verify({
    userId: user.id,
    type: input.type,
    number,
    holderName,
  })

  const now = new Date()
  const isVerified = verification.decision === 'VERIFIED'

  const result = await prisma.$transaction(async (tx) => {
    await tx.consentRecord.create({
      data: {
        userId: user.id,
        purpose: 'KYC_VERIFICATION',
        version: input.consentVersion,
        granted: true,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })

    const document = await tx.kycDocument.create({
      data: {
        userId: user.id,
        type: input.type,
        status: verification.decision,
        provider: 'MOCK',
        providerReference: verification.reference,
        numberLast4: number.slice(-4),
        numberHash,
        frontImageKey: input.frontImageKey ?? null,
        backImageKey: input.backImageKey ?? null,
        selfieImageKey: input.selfieImageKey ?? null,
        consentVersion: input.consentVersion,
        consentAt: now,
        rejectionReason: verification.reason ?? null,
        reviewedAt: isVerified ? now : null,
        verifiedAt: isVerified ? now : null,
      },
    })

    const summary = await syncUserKycStatus(tx, user.id)

    await recordAudit(tx, {
      actorType: 'USER',
      actorId: user.id,
      action: 'KYC_DOCUMENT_SUBMITTED',
      entityType: 'KycDocument',
      entityId: document.id,
      metadata: {
        type: input.type,
        decision: verification.decision,
        consentVersion: input.consentVersion,
      },
      ipAddress: input.ipAddress,
    })

    return { document, summary }
  })

  return {
    document: publicKycDocument(result.document),
    kycStatus: result.summary.status,
    kycVerifiedAt: result.summary.verifiedAt,
  }
}

export async function getMyKyc(userId: string) {
  const [user, documents] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, kycVerifiedAt: true },
    }),
    prisma.kycDocument.findMany({
      where: { userId, purgedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND')

  return {
    status: user.kycStatus,
    verifiedAt: user.kycVerifiedAt,
    requiredDocuments: ['AADHAAR'] as KycDocumentType[],
    documents: documents.map(publicKycDocument),
  }
}

const ADMIN_USER_FIELDS = {
  id: true,
  name: true,
  phone: true,
  city: true,
  kycStatus: true,
  createdAt: true,
} as const

type AdminKycUser = {
  id: string
  name: string | null
  phone: string
  city: string | null
  kycStatus: KycStatus
  createdAt: Date
}

function adminDocumentView(document: KycDocument, user?: AdminKycUser) {
  return {
    ...publicKycDocument(document),
    images: {
      front: document.frontImageKey,
      back: document.backImageKey,
      selfie: document.selfieImageKey,
    },
    user: user ? { ...user, phone: maskPhone(user.phone) } : undefined,
  }
}

/** Admin queue: oldest first so nobody waits indefinitely. */
export async function listKycQueue(input: {
  status: KycStatus
  cursor?: string
  limit: number
}) {
  const documents = await prisma.kycDocument.findMany({
    where: { status: input.status, purgedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { user: { select: ADMIN_USER_FIELDS } },
  })

  const hasMore = documents.length > input.limit
  const page = hasMore ? documents.slice(0, input.limit) : documents
  const last = page[page.length - 1]

  return {
    data: page.map((document) => adminDocumentView(document, document.user)),
    page: {
      nextCursor: hasMore && last ? last.id : null,
      hasMore,
      limit: input.limit,
    },
  }
}

export async function getKycDocumentForAdmin(documentId: string) {
  const document = await prisma.kycDocument.findUnique({
    where: { id: documentId },
    include: { user: { select: ADMIN_USER_FIELDS } },
  })
  if (!document) throw new AppError(404, 'KYC document not found', 'DOCUMENT_NOT_FOUND')
  return adminDocumentView(document, document.user)
}

export type KycDecisionInput = {
  adminId: string
  documentId: string
  decision: 'APPROVE' | 'REJECT'
  reason?: string
  ipAddress?: string
}

export async function decideKycDocument(input: KycDecisionInput) {
  const document = await prisma.kycDocument.findUnique({
    where: { id: input.documentId },
    include: { user: { select: { id: true, name: true, phone: true, city: true, kycStatus: true, createdAt: true } } },
  })
  if (!document) throw new AppError(404, 'KYC document not found', 'DOCUMENT_NOT_FOUND')

  if (document.userId === input.adminId) {
    throw new AppError(403, 'You cannot review your own KYC documents', 'SELF_REVIEW_FORBIDDEN')
  }
  if (document.status !== 'PENDING') {
    throw new AppError(409, 'This document has already been reviewed', 'DOCUMENT_ALREADY_REVIEWED')
  }
  if (input.decision === 'REJECT') {
    const reason = input.reason?.trim()
    if (!reason || reason.length < 5) {
      throw new AppError(400, 'A rejection reason of at least 5 characters is required', 'REASON_REQUIRED')
    }
  }

  const now = new Date()
  const approve = input.decision === 'APPROVE'

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.kycDocument.update({
      where: { id: document.id },
      data: {
        status: approve ? 'VERIFIED' : 'REJECTED',
        reviewedById: input.adminId,
        reviewedAt: now,
        verifiedAt: approve ? now : null,
        rejectionReason: approve ? null : (input.reason?.trim() ?? null),
      },
    })

    const summary = await syncUserKycStatus(tx, document.userId)

    await tx.adminAction.create({
      data: {
        adminId: input.adminId,
        action: approve ? 'KYC_APPROVED' : 'KYC_REJECTED',
        targetType: 'KycDocument',
        targetId: document.id,
        metadata: {
          type: document.type,
          userId: document.userId,
          ...(approve ? {} : { reason: input.reason?.trim() ?? null }),
        },
        ipAddress: input.ipAddress ?? null,
      },
    })

    await recordAudit(tx, {
      actorType: 'ADMIN',
      actorId: input.adminId,
      action: approve ? 'KYC_APPROVED' : 'KYC_REJECTED',
      entityType: 'KycDocument',
      entityId: document.id,
      metadata: { type: document.type, userId: document.userId },
      ipAddress: input.ipAddress,
    })

    return { document: updated, summary }
  })

  return {
    document: adminDocumentView(result.document, document.user),
    kycStatus: result.summary.status,
  }
}
