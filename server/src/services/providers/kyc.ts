import { randomBytes } from 'node:crypto'
import type { KycDocumentType } from '@prisma/client'

export type KycDecision = 'VERIFIED' | 'PENDING' | 'REJECTED'

export type KycVerificationInput = {
  userId: string
  type: KycDocumentType
  /** Normalised document number. Sent to the provider, never stored by us. */
  number: string
  holderName: string
}

export type KycVerificationResult = {
  reference: string
  decision: KycDecision
  reason?: string
}

export interface KycProvider {
  readonly name: string
  verify(input: KycVerificationInput): Promise<KycVerificationResult>
}

/**
 * Deterministic local provider:
 *   - an Aadhaar number ending in an even digit auto-verifies;
 *   - everything else (odd Aadhaar, PAN, driving licence) queues for admin review.
 * That exercises both the instant-verification and manual-review paths locally.
 */
class MockKycProvider implements KycProvider {
  readonly name = 'mock'

  async verify(input: KycVerificationInput): Promise<KycVerificationResult> {
    const reference = `mock_${input.type.toLowerCase()}_${randomBytes(8).toString('hex')}`

    if (input.type === 'AADHAAR') {
      const lastDigit = Number(input.number.slice(-1))
      if (Number.isFinite(lastDigit) && lastDigit % 2 === 0) {
        return { reference, decision: 'VERIFIED' }
      }
      return { reference, decision: 'PENDING' }
    }

    return { reference, decision: 'PENDING' }
  }
}

export const kycProvider: KycProvider = new MockKycProvider()
