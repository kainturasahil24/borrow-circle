import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  api,
  restoreSession,
  setSession,
  setSessionExpiredHandler,
  type PublicUser,
  type RequestOtpResult,
  type Session,
} from './api'

type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

type AuthValue = {
  status: AuthStatus
  user: PublicUser | null
  /** Phone number waiting for OTP entry. */
  pendingPhone: string | null
  /** Returned by the API only in local development. */
  devCode: string | null
  beginLogin: (phone: string, result: RequestOtpResult) => void
  completeLogin: (session: Session) => Promise<void>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  updateUser: (user: PublicUser) => void
  backToPhoneEntry: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<PublicUser | null>(null)
  const [pendingPhone, setPendingPhone] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  const refreshUser = useCallback(async () => {
    try {
      const fresh = await api.getMe()
      setUser(fresh)
    } catch {
      // 401 is handled by the session-expired callback below. Anything else
      // (offline, suspended) leaves the last known profile on screen.
    }
  }, [])

  useEffect(() => {
    let mounted = true

    setSessionExpiredHandler(() => {
      if (!mounted) return
      setUser(null)
      setStatus('signedOut')
      setPendingPhone(null)
      setDevCode(null)
    })

    void (async () => {
      const session = await restoreSession()
      if (!mounted) return
      if (session) {
        setUser(session.user)
        setStatus('signedIn')
        void refreshUser()
      } else {
        setStatus('signedOut')
      }
    })()

    return () => {
      mounted = false
      setSessionExpiredHandler(null)
    }
  }, [refreshUser])

  const beginLogin = useCallback((phone: string, result: RequestOtpResult) => {
    setPendingPhone(phone)
    setDevCode(result.devCode ?? null)
  }, [])

  const completeLogin = useCallback(async (session: Session) => {
    await setSession(session)
    setUser(session.user)
    setPendingPhone(null)
    setDevCode(null)
    setStatus('signedIn')
    // Pull the authoritative profile (role, KYC status) in the background.
    void (async () => {
      try {
        const fresh = await api.getMe()
        setUser(fresh)
      } catch {
        /* keep the session payload */
      }
    })()
  }, [])

  const signOut = useCallback(async () => {
    await api.logout()
    setUser(null)
    setPendingPhone(null)
    setDevCode(null)
    setStatus('signedOut')
  }, [])

  const backToPhoneEntry = useCallback(() => {
    setPendingPhone(null)
    setDevCode(null)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      pendingPhone,
      devCode,
      beginLogin,
      completeLogin,
      signOut,
      refreshUser,
      updateUser: setUser,
      backToPhoneEntry,
    }),
    [status, user, pendingPhone, devCode, beginLogin, completeLogin, signOut, refreshUser, backToPhoneEntry],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

