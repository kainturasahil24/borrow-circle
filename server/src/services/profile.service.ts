import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { recordAudit } from '../lib/audit'
import { AppError } from '../middleware/error'
import { revokeAllSessions } from './auth.service'
import { publicUser } from './serializers'

export const DELETION_GRACE_DAYS = 30
const DAY_MS = 86_400_000

export type UpdateProfileInput = {
  name?: string
  email?: string | null
  photoUrl?: string | null
  addressLine?: string | null
  city?: string | null
  state?: string | null
  pincode?: string | null
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND')
  return publicUser(user)
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  ipAddress?: string,
) {
  if (input.email) {
    const taken = await prisma.user.findFirst({
      where: { email: input.email, NOT: { id: userId } },
      select: { id: true },
    })
    if (taken) throw new AppError(409, 'That email is already in use', 'EMAIL_IN_USE')
  }

  const data: Prisma.UserUpdateInput = {}
  if (input.name !== undefined) data.name = input.name
  if (input.email !== undefined) data.email = input.email
  if (input.photoUrl !== undefined) data.photoUrl = input.photoUrl
  if (input.addressLine !== undefined) data.addressLine = input.addressLine
  if (input.city !== undefined) data.city = input.city
  if (input.state !== undefined) data.state = input.state
  if (input.pincode !== undefined) data.pincode = input.pincode

  if (Object.keys(data).length === 0) {
    throw new AppError(400, 'No profile fields to update', 'NOTHING_TO_UPDATE')
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data })
    await recordAudit(tx, {
      actorType: 'USER',
      actorId: userId,
      action: 'PROFILE_UPDATED',
      entityType: 'User',
      entityId: userId,
      // Field names only — never the values (name, address, email are PII).
      metadata: { fields: Object.keys(data) },
      ipAddress,
    })
    return updated
  })

  return publicUser(user)
}

export type DeletionStatus = { requestedAt: string; scheduledFor: string }

function deletionWindow(requestedAt: Date): DeletionStatus {
  return {
    requestedAt: requestedAt.toISOString(),
    scheduledFor: new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS).toISOString(),
  }
}

/**
 * Schedules erasure. The account stays readable until the retention job runs,
 * so the user can cancel inside the grace window. A production worker scrubs
 * PII and retains only financial/legal records (Phase 14).
 */
export async function requestDeletion(
  userId: string,
  ipAddress?: string,
): Promise<DeletionStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletionRequestedAt: true },
  })
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND')

  if (user.deletionRequestedAt) return deletionWindow(user.deletionRequestedAt)

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { deletionRequestedAt: now } })
    await recordAudit(tx, {
      actorType: 'USER',
      actorId: userId,
      action: 'ACCOUNT_DELETION_REQUESTED',
      entityType: 'User',
      entityId: userId,
      metadata: { graceDays: DELETION_GRACE_DAYS },
      ipAddress,
    })
  })

  // Sign out everywhere; the account can still log in again to cancel.
  await revokeAllSessions(userId, {
    reason: 'AUTH_LOGOUT_ALL',
    ipAddress,
  })

  return deletionWindow(now)
}

export async function cancelDeletion(userId: string, ipAddress?: string): Promise<DeletionStatus | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletionRequestedAt: true },
  })
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND')
  if (!user.deletionRequestedAt) {
    throw new AppError(400, 'No deletion request is active', 'NO_DELETION_REQUEST')
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { deletionRequestedAt: null } })
    await recordAudit(tx, {
      actorType: 'USER',
      actorId: userId,
      action: 'ACCOUNT_DELETION_CANCELLED',
      entityType: 'User',
      entityId: userId,
      ipAddress,
    })
  })

  return null
}
