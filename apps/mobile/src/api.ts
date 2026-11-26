import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '')

const ACCESS_KEY = 'bc.accessToken'
const REFRESH_KEY = 'bc.refreshToken'
const USER_KEY = 'bc.user'
const DEVICE_KEY = 'bc.deviceFingerprint'

export type KycStatusValue = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
export type KycDocumentType = 'AADHAAR' | 'PAN' | 'DRIVING_LICENCE'

export type PublicUser = {
  id: string
  phone: string
  name: string | null
  email: string | null
  photoUrl: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  pincode: string | null
  role: 'USER' | 'ADMIN'
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED'
  kycStatus: KycStatusValue
  kycVerifiedAt: string | null
  mfaEnabled: boolean
  trustScore: number
  ratingAvg: number
  ratingCount: number
  completedRentalsCount: number
  createdAt: string
  deletionRequestedAt: string | null
}

export type Session = {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: number
  user: PublicUser
  isNewUser?: boolean
}

export type RequestOtpResult = {
  sent: true
  expiresInSeconds: number
  resendAfterSeconds: number
  /** Only present when the API runs in local development. */
  devCode?: string
}

export type KycDocument = {
  id: string
  type: KycDocumentType
  status: KycStatusValue
  maskedNumber: string | null
  rejectionReason: string | null
  submittedAt: string
  reviewedAt: string | null
  verifiedAt: string | null
}

export type KycSummary = {
  status: KycStatusValue
  verifiedAt: string | null
  requiredDocuments: KycDocumentType[]
  documents: KycDocument[]
}

export type DeletionStatus = { requestedAt: string; scheduledFor: string }

export type SubmitKycInput = {
  type: KycDocumentType
  number: string
  consentVersion: string
  holderName?: string
  frontImageKey?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// Storage (SecureStore on device, localStorage on web preview)
// ---------------------------------------------------------------------------

type WebStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function webStorage(): WebStorage | undefined {
  return (globalThis as { localStorage?: WebStorage }).localStorage
}

const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return webStorage()?.getItem(key) ?? null
    return SecureStore.getItemAsync(key)
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(key, value)
      return
    }
    await SecureStore.setItemAsync(key, value)
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.removeItem(key)
      return
    }
    await SecureStore.deleteItemAsync(key)
  },
}

// ---------------------------------------------------------------------------
// Session state + automatic refresh
// ---------------------------------------------------------------------------

let current: Session | null = null
let refreshing: Promise<Session | null> | null = null
let onSessionExpired: (() => void) | null = null

export function getSession(): Session | null {
  return current
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

export async function setSession(session: Session): Promise<void> {
  current = session
  await Promise.all([
    storage.set(ACCESS_KEY, session.accessToken),
    storage.set(REFRESH_KEY, session.refreshToken),
    storage.set(USER_KEY, JSON.stringify(session.user)),
  ])
}

export async function clearSession(): Promise<void> {
  current = null
  await Promise.all([
    storage.remove(ACCESS_KEY),
    storage.remove(REFRESH_KEY),
    storage.remove(USER_KEY),
  ])
}

async function readJson<T>(res: Response): Promise<T | null> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } }

async function throwApiError(res: Response): Promise<never> {
  const body = await readJson<ErrorBody>(res)
  throw new ApiError(
    res.status,
    body?.error?.code ?? 'REQUEST_FAILED',
    body?.error?.message ?? 'Something went wrong. Please try again.',
    body?.error?.details,
  )
}

async function refreshWithToken(refreshToken: string): Promise<Session> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) await throwApiError(res)
  const session = await readJson<Session>(res)
  if (!session) throw new ApiError(500, 'EMPTY_RESPONSE', 'Could not refresh the session')
  return session
}

function refreshCurrentSession(): Promise<Session | null> {
  if (!current?.refreshToken) return Promise.resolve(null)
  if (!refreshing) {
    refreshing = refreshWithToken(current.refreshToken)
      .then(async (session) => {
        await setSession(session)
        return session
      })
      .catch(async () => {
        await clearSession()
        onSessionExpired?.()
        return null
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  }
  if (current) headers.Authorization = `Bearer ${current.accessToken}`

  const res = await fetch(`${API_URL}${path}`, { ...init, headers })

  if (res.status === 401 && retry && current?.refreshToken) {
    const refreshed = await refreshCurrentSession()
    if (refreshed) return request<T>(path, init, false)
  }

  if (!res.ok) await throwApiError(res)
  const body = await readJson<T>(res)
  if (body === null) throw new ApiError(500, 'EMPTY_RESPONSE', 'The server returned no data')
  return body
}

/** Reads persisted tokens and validates them by rotating the refresh token. */
export async function restoreSession(): Promise<Session | null> {
  const [refreshToken, userJson] = await Promise.all([
    storage.get(REFRESH_KEY),
    storage.get(USER_KEY),
  ])
  if (!refreshToken || !userJson) return null

  try {
    const session = await refreshWithToken(refreshToken)
    await setSession(session)
    return session
  } catch {
    await clearSession()
    return null
  }
}

/** Stable per-install id used for the device list. Not a hardware identifier. */
export async function getDeviceFingerprint(): Promise<string> {
  const existing = await storage.get(DEVICE_KEY)
  if (existing) return existing
  const generated = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
  await storage.set(DEVICE_KEY, generated)
  return generated
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  async requestOtp(phone: string): Promise<RequestOtpResult> {
    const body = await request<{ otp: RequestOtpResult }>(
      '/auth/otp/request',
      { method: 'POST', body: JSON.stringify({ phone }) },
      false,
    )
    return body.otp
  },

  async verifyOtp(phone: string, code: string): Promise<Session> {
    const deviceFingerprint = await getDeviceFingerprint()
    const platform =
      Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'unknown'
    return request<Session>(
      '/auth/otp/verify',
      {
        method: 'POST',
        body: JSON.stringify({ phone, code, device: { fingerprint: deviceFingerprint, platform } }),
      },
      false,
    )
  },

  async logout(): Promise<void> {
    const refreshToken = current?.refreshToken
    if (refreshToken) {
      try {
        await request('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        })
      } catch {
        // Signing out locally must succeed even if the network fails.
      }
    }
    await clearSession()
  },

  async logoutAll(): Promise<void> {
    await request('/auth/logout-all', { method: 'POST' })
    await clearSession()
  },

  async getMe(): Promise<PublicUser> {
    const body = await request<{ user: PublicUser }>('/me')
    return body.user
  },

  async updateProfile(patch: Partial<Pick<PublicUser, 'name' | 'email' | 'photoUrl' | 'addressLine' | 'city' | 'state' | 'pincode'>>): Promise<PublicUser> {
    const body = await request<{ user: PublicUser }>('/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return body.user
  },

  async getKyc(): Promise<KycSummary> {
    return request<KycSummary>('/me/kyc')
  },

  async submitKycDocument(input: SubmitKycInput): Promise<{ document: KycDocument; kycStatus: KycStatusValue }> {
    return request('/me/kyc/documents', { method: 'POST', body: JSON.stringify(input) })
  },

  async requestDeletion(): Promise<DeletionStatus> {
    const body = await request<{ deletion: DeletionStatus }>('/me', { method: 'DELETE' })
    return body.deletion
  },

  async cancelDeletion(): Promise<void> {
    await request('/me/deletion/cancel', { method: 'POST' })
  },
}
