import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export type AuditActorType = 'USER' | 'ADMIN' | 'SYSTEM'

export type AuditInput = {
  actorType?: AuditActorType
  actorId?: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  metadata?: Prisma.InputJsonValue
  ipAddress?: string | null
}

/**
 * Deterministic JSON with sorted keys, so the same payload always hashes the
 * same regardless of insertion order.
 */
function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
  return `{${entries.join(',')}}`
}

/**
 * Appends one audit row, linking it to the previous row's hash.
 *
 * Must run inside a transaction: a transaction-scoped advisory lock serialises
 * concurrent writers so two requests can never extend the chain from the same
 * predecessor (which would fork it). Updates/deletes are never issued here.
 */
export async function recordAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('borrow_circle.audit_log'))`

  const previous = await tx.auditLog.findFirst({
    orderBy: { seq: 'desc' },
    select: { hash: true },
  })

  const createdAt = new Date()
  const prevHash = previous?.hash ?? null
  const payload = {
    prevHash,
    actorType: input.actorType ?? null,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    createdAt: createdAt.toISOString(),
  }
  const hash = createHash('sha256').update(canonical(payload)).digest('hex')

  await tx.auditLog.create({
    data: {
      prevHash,
      hash,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ipAddress: input.ipAddress ?? null,
      createdAt,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  })
}
