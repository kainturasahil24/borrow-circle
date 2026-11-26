import type { KycStatus, UserRole, UserStatus } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by the `authenticate` middleware. Absent on public routes.
       * Role/status/KYC come from the database, not from the token.
       */
      auth?: {
        userId: string
        role: UserRole
        status: UserStatus
        kycStatus: KycStatus
        phone: string
        /** Refresh-token family for the current login session. */
        sessionId: string
      }
    }
  }
}

export {}
