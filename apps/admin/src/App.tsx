import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  adminApi,
  type AdminUser,
  type KycStatus,
  type QueueDocument,
} from './api'

type Health = 'checking' | 'up' | 'down'

export default function App() {
  const [health, setHealth] = useState<Health>('checking')
  const [booting, setBooting] = useState(true)
  const [user, setUser] = useState<AdminUser | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/health', { signal: controller.signal })
      .then((res) => setHealth(res.ok ? 'up' : 'down'))
      .catch(() => setHealth('down'))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    let active = true
    void adminApi
      .bootstrap()
      .then((session) => {
        if (active) setUser(session?.user ?? null)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setBooting(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (booting) {
    return (
      <main className="shell">
        <p className="muted">Checking your admin session…</p>
      </main>
    )
  }

  if (!user) {
    return <LoginScreen health={health} onSignedIn={setUser} />
  }

  return (
    <Dashboard
      user={user}
      health={health}
      onSignedOut={() => setUser(null)}
    />
  )
}

function HealthPill({ health }: { health: Health }) {
  return (
    <span className={`pill pill--${health}`}>
      <span className="dot" aria-hidden="true" />
      API {health}
    </span>
  )
}

function LoginScreen({
  health,
  onSignedIn,
}: {
  health: Health
  onSignedIn: (user: AdminUser) => void
}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await adminApi.requestOtp(phone)
      setDevCode(result.devCode ?? null)
      setStep('code')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send the code')
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const session = await adminApi.verifyOtp(phone, code)
      onSignedIn(session.user)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not verify the code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell shell--narrow">
      <header className="topbar">
        <div>
          <p className="eyebrow">Borrow Circle</p>
          <h1>Admin</h1>
        </div>
        <HealthPill health={health} />
      </header>

      <section className="panel">
        <h2>{step === 'phone' ? 'Sign in with your admin number' : 'Enter the 6-digit code'}</h2>
        <p>
          {step === 'phone'
            ? 'Only numbers on the ADMIN_PHONES allow-list can access this dashboard.'
            : `We sent a code to ${phone}. It expires in a few minutes.`}
        </p>

        {devCode ? (
          <p className="dev-hint">Development code: <strong>{devCode}</strong></p>
        ) : null}

        <form onSubmit={step === 'phone' ? sendCode : verify} className="form">
          {step === 'phone' ? (
            <label className="field">
              <span>Mobile number</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+91 98765 43210"
                inputMode="tel"
                autoComplete="tel"
                required
              />
            </label>
          ) : (
            <label className="field">
              <span>Code</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
              />
            </label>
          )}

          {error ? <p className="alert" role="alert">{error}</p> : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : step === 'phone' ? 'Send code' : 'Sign in'}
          </button>

          {step === 'code' ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setStep('phone')
                setCode('')
                setError(null)
              }}
            >
              Use a different number
            </button>
          ) : null}
        </form>
      </section>

      <footer className="footer">
        Sessions are remembered in this tab only. Admin MFA arrives with Phase 14.
      </footer>
    </main>
  )
}

function Dashboard({
  user,
  health,
  onSignedOut,
}: {
  user: AdminUser
  health: Health
  onSignedOut: () => void
}) {
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    await adminApi.logout()
    setSigningOut(false)
    onSignedOut()
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Borrow Circle</p>
          <h1>KYC review</h1>
        </div>
        <div className="topbar-actions">
          <HealthPill health={health} />
          <span className="muted small">{user.phone}</span>
          <button className="btn btn--ghost btn--small" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>

      <KycQueue onUnauthorized={() => void signOut()} />
    </main>
  )
}

const STATUS_TABS: { value: KycStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function KycQueue({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [status, setStatus] = useState<KycStatus>('PENDING')
  const [documents, setDocuments] = useState<QueueDocument[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleError = useCallback(
    (caught: unknown) => {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong')
    },
    [onUnauthorized],
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setSelectedId(null)
    void adminApi
      .listKyc(status)
      .then((result) => {
        if (!active) return
        setDocuments(result.data)
        setCursor(result.page.nextCursor)
        setHasMore(result.page.hasMore)
      })
      .catch((caught) => {
        if (active) handleError(caught)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [status, refreshKey, handleError])

  async function loadMore() {
    if (!cursor) return
    setLoading(true)
    try {
      const result = await adminApi.listKyc(status, cursor)
      setDocuments((current) => [...current, ...result.data])
      setCursor(result.page.nextCursor)
      setHasMore(result.page.hasMore)
    } catch (caught) {
      handleError(caught)
    } finally {
      setLoading(false)
    }
  }

  function afterDecision(message: string) {
    setNotice(message)
    setSelectedId(null)
    setRefreshKey((key) => key + 1)
  }

  const selected = documents.find((document) => document.id === selectedId) ?? null

  return (
    <>
      <section className="panel">
        <div className="tabs" role="tablist" aria-label="KYC status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={status === tab.value}
              className={`tab ${status === tab.value ? 'tab--active' : ''}`}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {notice ? (
          <p className="alert alert--success" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}

        {loading && documents.length === 0 ? (
          <p className="muted">Loading documents…</p>
        ) : documents.length === 0 ? (
          <p className="muted">Nothing in this queue. Good work.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Document</th>
                <th>Last 4</th>
                <th>Submitted</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id} className={document.id === selectedId ? 'row--active' : ''}>
                  <td>
                    <div>{document.user?.name ?? 'Unnamed user'}</div>
                    <div className="muted small">{document.user?.phone ?? '—'}</div>
                  </td>
                  <td>{document.type.replace('_', ' ')}</td>
                  <td className="mono">{document.numberLast4 ? `•••• ${document.numberLast4}` : '—'}</td>
                  <td className="muted small">{formatDate(document.submittedAt)}</td>
                  <td>
                    <button className="btn btn--ghost btn--small" onClick={() => setSelectedId(document.id)}>
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {hasMore ? (
          <button className="btn btn--ghost" onClick={() => void loadMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </section>

      {selected ? (
        <ReviewPanel
          document={selected}
          onClose={() => setSelectedId(null)}
          onDecided={afterDecision}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </>
  )
}

function ReviewPanel({
  document,
  onClose,
  onDecided,
  onUnauthorized,
}: {
  document: QueueDocument
  onClose: () => void
  onDecided: (message: string) => void
  onUnauthorized: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'APPROVE' | 'REJECT') {
    setError(null)
    setBusy(decision)
    try {
      await adminApi.decideKyc(
        document.id,
        decision,
        decision === 'REJECT' ? reason.trim() : undefined,
      )
      onDecided(
        decision === 'APPROVE'
          ? 'Document approved. The user has been notified by status only.'
          : 'Document rejected. The user will see your reason.',
      )
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'Could not save the decision')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel panel--review">
      <div className="review-head">
        <div>
          <h2>Review {document.type.replace('_', ' ')}</h2>
          <p className="muted small">
            {document.user?.name ?? 'Unnamed user'} · {document.user?.phone ?? '—'} ·{' '}
            {document.user?.city ?? 'City not set'}
          </p>
        </div>
        <button className="btn btn--ghost btn--small" onClick={onClose}>
          Close
        </button>
      </div>

      <dl className="detail-grid">
        <div>
          <dt>Document number</dt>
          <dd className="mono">{document.maskedNumber ?? '—'}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDate(document.submittedAt)}</dd>
        </div>
        <div>
          <dt>Account KYC</dt>
          <dd>{document.user?.kycStatus.replace('_', ' ') ?? '—'}</dd>
        </div>
        <div>
          <dt>Images</dt>
          <dd>
            {document.images.front || document.images.back || document.images.selfie
              ? 'Attached (viewer lands in Phase 10)'
              : 'None uploaded'}
          </dd>
        </div>
      </dl>

      <p className="muted small">
        Only the last four digits are stored. Verify the document in your KYC partner console
        before approving.
      </p>

      {error ? <p className="alert" role="alert">{error}</p> : null}

      <div className="review-actions">
        <button
          className="btn"
          onClick={() => void decide('APPROVE')}
          disabled={busy !== null}
        >
          {busy === 'APPROVE' ? 'Approving…' : 'Approve'}
        </button>

        <div className="reject-block">
          <label className="field">
            <span>Rejection reason (visible to the user)</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Aadhaar number does not match the uploaded image"
              maxLength={500}
            />
          </label>
          <button
            className="btn btn--danger"
            onClick={() => void decide('REJECT')}
            disabled={busy !== null || reason.trim().length < 5}
          >
            {busy === 'REJECT' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </section>
  )
}
