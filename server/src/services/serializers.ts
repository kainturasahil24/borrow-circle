import type {
  KycDocumentType,
  KycProvider,
  KycStatus,
  UserRole,
  UserStatus,
} from '@prisma/client'

export type UserLike = {
  id: string
  phone: string
  name: string | null
  email: string | null
  photoUrl: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  pincode: string | null
  role: UserRole
  status: UserStatus
  kycStatus: KycStatus
  kycVerifiedAt: Date | null
  mfaEnabled: boolean
  trustScore: number
  ratingAvg: number
  ratingCount: number
  completedRentalsCount: number
  createdAt: Date
  deletionRequestedAt: Date | null
}

export type PublicUser = Omit<UserLike, 'deletionRequestedAt'> & {
  deletionRequestedAt: string | null
}

export function publicUser(user: UserLike): PublicUser {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    photoUrl: user.photoUrl,
    addressLine: user.addressLine,
    city: user.city,
    state: user.state,
    pincode: user.pincode,
    role: user.role,
    status: user.status,
    kycStatus: user.kycStatus,
    kycVerifiedAt: user.kycVerifiedAt,
    mfaEnabled: user.mfaEnabled,
    trustScore: user.trustScore,
    ratingAvg: user.ratingAvg,
    ratingCount: user.ratingCount,
    completedRentalsCount: user.completedRentalsCount,
    createdAt: user.createdAt,
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
  }
}

export type KycDocumentLike = {
  id: string
  type: KycDocumentType
  status: KycStatus
  provider: KycProvider
  numberLast4: string | null
  rejectionReason: string | null
  createdAt: Date
  reviewedAt: Date | null
  verifiedAt: Date | null
}

/** Masked for everyone: no full numbers, hashes, provider refs or image keys. */
export function publicKycDocument(doc: KycDocumentLike) {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    provider: doc.provider,
    numberLast4: doc.numberLast4,
    maskedNumber: doc.numberLast4 ? `•••• •••• ${doc.numberLast4}` : null,
    rejectionReason: doc.rejectionReason,
    submittedAt: doc.createdAt,
    reviewedAt: doc.reviewedAt,
    verifiedAt: doc.verifiedAt,
  }
}
