/**
 * Minimal API client for the admin SPA.
 *
 * Tokens live in memory for the live request plus sessionStorage so a refresh
 * keeps the operator signed in. This is a deliberate Phase 2 trade-off: the
 * production admin will move to httpOnly cookies + MFA (see docs/decisions.md).
 */

const BASE = '/api/v1'
const REFRESH_KEY = 'bc.admin.refresh'
const USER_KEY = 'bc.admin.user'

export type AdminRole = 'USER' | 'ADMIN'

export type AdminUser = {
  id: string
  name: string | null
  phone: string
  role: AdminRole
}

export type AdminSession = {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: number
  user: AdminUser
}

export type KycDocumentType = 'AADHAAR' | 'PAN' | 'DRIVING_LICENCE'
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'

export type QueueUser = {
  id: string
  name: string | null
  phone: string
  city: string | null
  kycStatus: KycStatus
  createdAt: string
}

export type QueueDocument = {
  id: string
  type: KycDocumentType
  status: KycStatus
  maskedNumber: string | null
  numberLast4: string | null
  rejectionReason: string | null
  submittedAt: string
  reviewedAt: string | null
  verifiedAt: string | null
  images: { front: string | null; back: string | null; selfie: string | null }
  user?: QueueUser
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

let accessToken: string | null = null
let refreshToken: string | null = null

function readSessionStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSessionStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch {
    /* storage disabled: the session still works until reload */
  }
}

async function parse<T>(res: Response): Promise<T | null> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } }

async function fail(res: Response): Promise<never> {
  const body = await parse<ErrorBody>(res)
  throw new ApiError(
    res.status,
    body?.error?.code ?? 'REQUEST_FAILED',
    body?.error?.message ?? 'Request failed',
    body?.error?.details,
  )
}

function applySession(session: AdminSession): AdminSession {
  accessToken = session.accessToken
  refreshToken = session.refreshToken
  writeSessionStorage(REFRESH_KEY, session.refreshToken)
  writeSessionStorage(USER_KEY, JSON.stringify(session.user))
  return session
}

export function clearSession(): void {
  accessToken = null
  refreshToken = null
  writeSessionStorage(REFRESH_KEY, null)
  writeSessionStorage(USER_KEY, null)
}

export function storedUser(): AdminUser | null {
  const raw = readSessionStorage(USER_KEY)
  if (!raw) return null
  try {
    const user = JSON.parse(raw) as AdminUser
    return user.role === 'ADMIN' ? user : null
  } catch {
    return null
  }
}

async function refreshSession(): Promise<AdminSession | null> {
  const token = refreshToken ?? readSessionStorage(REFRESH_KEY)
  if (!token) return null

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: token }),
  })
  if (!res.ok) {
    clearSession()
    return null
  }
  const session = await parse<AdminSession>(res)
  if (!session) {
    clearSession()
    return null
  }
  if (session.user.role !== 'ADMIN') {
    clearSession()
    return null
  }
  return applySession(session)
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (res.status === 401 && retry) {
    const session = await refreshSession()
    if (session) return request<T>(path, init, false)
  }

  if (!res.ok) await fail(res)
  const body = await parse<T>(res)
  if (body === null) throw new ApiError(500, 'EMPTY_RESPONSE', 'The server returned no data')
  return body
}

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (digits.length === 10) return `+91${digits}`
  return input.trim()
}

export const adminApi = {
  async requestOtp(phone: string): Promise<{ devCode?: string; expiresInSeconds: number }> {
    const body = await request<{ otp: { devCode?: string; expiresInSeconds: number } }>(
      '/auth/otp/request',
      { method: 'POST', body: JSON.stringify({ phone: normalizePhone(phone) }) },
      false,
    )
    return body.otp
  },

  /** Signs in, then rejects non-admin numbers by revoking the fresh session. */
  async verifyOtp(phone: string, code: string): Promise<AdminSession> {
    const session = await request<AdminSession>(
      '/auth/otp/verify',
      {
        method: 'POST',
        body: JSON.stringify({
          phone: normalizePhone(phone),
          code,
          device: { fingerprint: `admin-web-${window.navigator.userAgent.slice(0, 40)}`, platform: 'web' },
        }),
      },
      false,
    )

    if (session.user.role !== 'ADMIN') {
      try {
        await fetch(`${BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        })
      } catch {
        /* best effort */
      }
      throw new ApiError(
        403,
        'NOT_ADMIN',
        'This number is not an admin account. Ask an existing admin to add it to ADMIN_PHONES.',
      )
    }

    return applySession(session)
  },

  /** Restores a session from sessionStorage, rotating the refresh token. */
  async bootstrap(): Promise<AdminSession | null> {
    return refreshSession()
  },

  async logout(): Promise<void> {
    const token = refreshToken ?? readSessionStorage(REFRESH_KEY)
    if (token) {
      try {
        await fetch(`${BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
        })
      } catch {
        /* best effort */
      }
    }
    clearSession()
  },

  async listKyc(status: KycStatus, cursor?: string): Promise<{
    data: QueueDocument[]
    page: { nextCursor: string | null; hasMore: boolean }
  }> {
    const search = new URLSearchParams({ status, limit: '20' })
    if (cursor) search.set('cursor', cursor)
    return request<{
      data: QueueDocument[]
      page: { nextCursor: string | null; hasMore: boolean }
    }>(`/admin/kyc?${search.toString()}`)
  },

  async getKycDocument(id: string): Promise<QueueDocument> {
    const body = await request<{ document: QueueDocument }>(`/admin/kyc/${id}`)
    return body.document
  },

  async decideKyc(
    id: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ): Promise<{ kycStatus: KycStatus }> {
    return request<{ kycStatus: KycStatus }>(`/admin/kyc/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
    })
  },
}
