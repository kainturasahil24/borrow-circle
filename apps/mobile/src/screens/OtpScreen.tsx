import React, { useEffect, useRef, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { ApiError, api } from '../api'
import { useAuth } from '../auth'
import { Body, LinkButton, Notice, PrimaryButton, Screen, TextField } from '../components'
import { colors, spacing, typography } from '../theme'

const RESEND_SECONDS = 30

export function OtpScreen() {
  const { pendingPhone, devCode, completeLogin, beginLogin, backToPhoneEntry } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS)
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null)

  const phone = pendingPhone ?? ''
  const maskedPhone = phone.replace(/^\+91(\d{2})\d{6}(\d{2})$/, '+91 $1••••••$2')

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft((value) => Math.max(value - 1, 0)), 1_000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  async function submit(value = code) {
    if (!/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const session = await api.verifyOtp(phone, value)
      await completeLogin(session)
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setCode('')
        inputRef.current?.focus()
      } else {
        setError('Could not verify the code. Check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function resend() {
    if (secondsLeft > 0) return
    setError(null)
    try {
      const result = await api.requestOtp(phone)
      beginLogin(phone, result)
      setCode('')
      setSecondsLeft(RESEND_SECONDS)
      inputRef.current?.focus()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not resend the code')
    }
  }

  return (
    <Screen>
      <View style={styles.top}>
        <LinkButton label="← Change number" onPress={backToPhoneEntry} />
      </View>

      <Text style={styles.heading}>Enter your code</Text>
      <Body muted>We sent a 6-digit code to {maskedPhone || 'your phone'}.</Body>

      {devCode ? (
        <Notice tone="warning">
          Development mode: your code is {devCode}. This is never shown in production.
        </Notice>
      ) : null}

      <TextField
        ref={inputRef}
        label="6-digit code"
        value={code}
        onChangeText={(value) => {
          const digits = value.replace(/\D/g, '').slice(0, 6)
          setCode(digits)
          if (error) setError(null)
          if (digits.length === 6) void submit(digits)
        }}
        placeholder="••••••"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus
        style={styles.codeInput}
        error={error}
      />

      <PrimaryButton
        label="Verify and continue"
        onPress={() => {
          void submit()
        }}
        loading={loading}
        disabled={code.length !== 6}
      />

      <View style={styles.resendRow}>
        {secondsLeft > 0 ? (
          <Text style={styles.resendText}>Resend code in {secondsLeft}s</Text>
        ) : (
          <LinkButton
            label="Resend code"
            onPress={() => {
              void resend()
            }}
          />
        )}
      </View>
    </Screen>
  )
}

const styles = {
  top: { marginBottom: spacing.sm },
  heading: { color: colors.text, ...typography.display },
  codeInput: {
    letterSpacing: 10,
    fontSize: 24,
    textAlign: 'center' as const,
  } as const,
  resendRow: { alignItems: 'center' as const, marginTop: spacing.sm },
  resendText: { color: colors.textSubtle, ...typography.small },
}
