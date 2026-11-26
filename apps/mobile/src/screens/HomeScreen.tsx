import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import {
  ApiError,
  api,
  type KycDocumentType,
  type KycStatusValue,
  type KycSummary,
} from '../api'
import { useAuth } from '../auth'
import {
  Badge,
  Body,
  Card,
  LinkButton,
  Notice,
  PrimaryButton,
  Row,
  Screen,
  SectionTitle,
  TextField,
  type BadgeTone,
} from '../components'
import { colors, radii, spacing, typography } from '../theme'

/** Version of the KYC consent copy the app is showing. Bump with legal changes. */
const KYC_CONSENT_VERSION = '2026-11'

const KYC_TONE: Record<KycStatusValue, BadgeTone> = {
  NOT_STARTED: 'neutral',
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
}

const KYC_LABEL: Record<KycStatusValue, string> = {
  NOT_STARTED: 'Not started',
  PENDING: 'Under review',
  VERIFIED: 'Verified',
  REJECTED: 'Needs attention',
}

const DOCUMENT_OPTIONS: { type: KycDocumentType; label: string; hint: string }[] = [
  { type: 'AADHAAR', label: 'Aadhaar', hint: '12-digit Aadhaar number' },
  { type: 'PAN', label: 'PAN', hint: 'PAN like ABCDE1234F' },
  { type: 'DRIVING_LICENCE', label: 'Driving licence', hint: 'Driving licence number' },
]

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toDateString()
}

export function HomeScreen() {
  const { user, signOut, refreshUser, updateUser } = useAuth()
  const [kyc, setKyc] = useState<KycSummary | null>(null)
  const [kycError, setKycError] = useState<string | null>(null)

  const loadKyc = useCallback(async () => {
    try {
      const summary = await api.getKyc()
      setKyc(summary)
      setKycError(null)
    } catch (caught) {
      setKycError(caught instanceof ApiError ? caught.message : 'Could not load KYC status')
    }
  }, [])

  useEffect(() => {
    void loadKyc()
  }, [loadKyc])

  if (!user) return null

  return (
    <Screen>
      <Row style={styles.topRow}>
        <View style={styles.greeting}>
          <Text style={styles.hello}>Hello{user.name ? `, ${user.name.split(' ')[0]}` : ''}</Text>
          <Text style={styles.phone}>{user.phone}</Text>
        </View>
        <LinkButton
          label="Sign out"
          onPress={() => {
            void signOut()
          }}
        />
      </Row>

      <ProfileCard
        initialName={user.name ?? ''}
        initialCity={user.city ?? ''}
        email={user.email ?? ''}
        onSaved={(updated) => {
          updateUser(updated)
          void refreshUser()
        }}
      />

      <KycCard
        summary={kyc}
        loadError={kycError}
        userKycStatus={user.kycStatus}
        onChanged={async () => {
          await loadKyc()
          await refreshUser()
        }}
      />

      <AccountCard
        deletionRequestedAt={user.deletionRequestedAt}
        onRequested={async () => {
          await signOut()
        }}
        onChanged={refreshUser}
      />

      <Text style={styles.footer}>
        Phase 2 · Auth, profile and KYC. Listings and contracts arrive next.
      </Text>
    </Screen>
  )
}

function ProfileCard({
  initialName,
  initialCity,
  email,
  onSaved,
}: {
  initialName: string
  initialCity: string
  email: string
  onSaved: (user: Awaited<ReturnType<typeof api.getMe>>) => void
}) {
  const [name, setName] = useState(initialName)
  const [city, setCity] = useState(initialCity)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    setMessage(null)
    if (name.trim().length < 2) {
      setError('Enter your full name (at least 2 characters)')
      return
    }
    setSaving(true)
    try {
      const updated = await api.updateProfile({ name: name.trim(), city: city.trim() || null })
      setMessage('Profile updated')
      onSaved(updated)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <SectionTitle>Your profile</SectionTitle>
      <TextField
        label="Full name"
        value={name}
        onChangeText={setName}
        placeholder="As on your ID"
        autoCapitalize="words"
        maxLength={80}
      />
      <TextField
        label="City"
        value={city}
        onChangeText={setCity}
        placeholder="Bengaluru"
        autoCapitalize="words"
        maxLength={80}
      />
      {email ? <Body muted>Email: {email}</Body> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      <PrimaryButton
        label="Save profile"
        onPress={() => {
          void save()
        }}
        loading={saving}
      />
    </Card>
  )
}

function KycCard({
  summary,
  loadError,
  userKycStatus,
  onChanged,
}: {
  summary: KycSummary | null
  loadError: string | null
  userKycStatus: KycStatusValue
  onChanged: () => Promise<void>
}) {
  const status = summary?.status ?? userKycStatus
  const [type, setType] = useState<KycDocumentType>('AADHAAR')
  const [number, setNumber] = useState('')
  const [consented, setConsented] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const selected = DOCUMENT_OPTIONS.find((option) => option.type === type) ?? DOCUMENT_OPTIONS[0]

  async function submit() {
    setError(null)
    setMessage(null)
    if (!consented) {
      setError('Tick the consent box to continue')
      return
    }
    if (number.trim().length < 4) {
      setError(`Enter your ${selected.label} number`)
      return
    }

    setSubmitting(true)
    try {
      const result = await api.submitKycDocument({
        type,
        number: number.trim(),
        consentVersion: KYC_CONSENT_VERSION,
      })
      setNumber('')
      setConsented(false)
      setMessage(
        result.kycStatus === 'VERIFIED'
          ? 'Verified. You can start lending and borrowing.'
          : 'Submitted. Our team will review it within 1-2 working days.',
      )
      await onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not submit the document')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <Row style={styles.spaceBetween}>
        <SectionTitle>Identity verification</SectionTitle>
        <Badge label={KYC_LABEL[status]} tone={KYC_TONE[status]} />
      </Row>

      {loadError ? <Notice tone="danger">{loadError}</Notice> : null}

      {summary && summary.documents.length > 0 ? (
        <View style={styles.documentList}>
          {summary.documents.map((document) => (
            <Row key={document.id} style={styles.spaceBetween}>
              <Text style={styles.documentType}>{document.type.replace('_', ' ')}</Text>
              <Badge label={document.status} tone={KYC_TONE[document.status]} />
            </Row>
          ))}
        </View>
      ) : (
        <Body muted>
          Verify your Aadhaar to build trust with neighbours. Only the last 4 digits are kept —
          never your full number.
        </Body>
      )}

      {summary?.status === 'VERIFIED' ? (
        <Notice tone="success">
          Verified{summary.verifiedAt ? ` on ${formatDate(summary.verifiedAt)}` : ''}.
        </Notice>
      ) : (
        <>
          {summary?.documents.some((document) => document.rejectionReason) ? (
            <Notice tone="warning">
              {summary.documents.find((document) => document.rejectionReason)?.rejectionReason}
            </Notice>
          ) : null}

          <View style={styles.chipRow}>
            {DOCUMENT_OPTIONS.map((option) => {
              const active = option.type === type
              return (
                <Pressable
                  key={option.type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setType(option.type)
                    setNumber('')
                    setError(null)
                    setMessage(null)
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <TextField
            label={`${selected.label} number`}
            value={number}
            onChangeText={setNumber}
            placeholder={selected.hint}
            autoCapitalize={type === 'AADHAAR' ? 'none' : 'characters'}
            keyboardType={type === 'AADHAAR' ? 'number-pad' : 'default'}
            maxLength={type === 'AADHAAR' ? 12 : 20}
          />

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consented }}
            onPress={() => setConsented((value) => !value)}
            style={styles.consentRow}
          >
            <View style={[styles.checkbox, consented && styles.checkboxChecked]}>
              {consented ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>
              I consent to Borrow Circle verifying this document with its KYC partner and storing
              a masked copy. I can withdraw consent by contacting support.
            </Text>
          </Pressable>

          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}

          <PrimaryButton
            label="Submit for verification"
            onPress={() => {
              void submit()
            }}
            loading={submitting}
          />
        </>
      )}
    </Card>
  )
}

function AccountCard({
  deletionRequestedAt,
  onRequested,
  onChanged,
}: {
  deletionRequestedAt: string | null
  onRequested: () => Promise<void>
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestDeletion() {
    setBusy(true)
    setError(null)
    try {
      const deletion = await api.requestDeletion()
      Alert.alert(
        'Deletion scheduled',
        `Your account will be deleted on ${formatDate(deletion.scheduledFor)}. Sign in again before then to cancel.`,
      )
      await onRequested()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not request deletion')
    } finally {
      setBusy(false)
    }
  }

  async function cancelDeletion() {
    setBusy(true)
    setError(null)
    try {
      await api.cancelDeletion()
      await onChanged()
      Alert.alert('Deletion cancelled', 'Your account will stay active.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not cancel deletion')
    } finally {
      setBusy(false)
    }
  }

  if (deletionRequestedAt) {
    return (
      <Card>
        <SectionTitle>Account deletion scheduled</SectionTitle>
        <Notice tone="warning">
          Requested on {formatDate(deletionRequestedAt)}. Your data will be erased after the
          30-day grace period.
        </Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <PrimaryButton
          label="Keep my account"
          onPress={() => {
            void cancelDeletion()
          }}
          loading={busy}
        />
      </Card>
    )
  }

  return (
    <Card>
      <SectionTitle>Delete account</SectionTitle>
      <Body muted>
        Schedules erasure after a 30-day grace period. Active rentals and legally required records
        are handled separately.
      </Body>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <PrimaryButton
        label="Request deletion"
        variant="danger"
        onPress={() => {
          Alert.alert(
            'Delete your account?',
            'You can cancel within 30 days by signing in again.',
            [
              { text: 'Keep account', style: 'cancel' },
              {
                text: 'Request deletion',
                style: 'destructive',
                onPress: () => {
                  void requestDeletion()
                },
              },
            ],
          )
        }}
        loading={busy}
      />
    </Card>
  )
}

const styles = {
  topRow: { justifyContent: 'space-between' as const, alignItems: 'flex-start' as const },
  greeting: { gap: 2 },
  hello: { color: colors.text, ...typography.title },
  phone: { color: colors.textMuted, ...typography.small },
  spaceBetween: { justifyContent: 'space-between' as const },
  documentList: { gap: spacing.sm },
  documentType: { color: colors.text, ...typography.small, textTransform: 'capitalize' as const },
  chipRow: { flexDirection: 'row' as const, gap: spacing.sm, flexWrap: 'wrap' as const },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderMuted,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: 'rgba(20, 184, 166, 0.12)' },
  chipText: { color: colors.textMuted, ...typography.small },
  chipTextActive: { color: colors.primary, fontWeight: '700' as const },
  consentRow: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'flex-start' as const },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderMuted,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.onPrimary, fontWeight: '800' as const, fontSize: 13 },
  consentText: { flex: 1, color: colors.textMuted, ...typography.small, lineHeight: 19 },
  footer: { color: colors.textSubtle, ...typography.small, textAlign: 'center' as const, marginTop: spacing.sm },
}
