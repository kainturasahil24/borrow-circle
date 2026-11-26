import React, { useState } from 'react'
import { Text, View } from 'react-native'
import { ApiError, api } from '../api'
import { useAuth } from '../auth'
import { Body, BrandHeader, Card, Notice, PrimaryButton, Screen, TextField } from '../components'
import { colors, spacing, typography } from '../theme'

/** Accepts "98765 43210", "09876543210" or "+91 98765 43210" and returns 10 digits. */
export function normalizeIndianPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

export function PhoneScreen() {
  const { beginLogin } = useAuth()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit() {
    const local = normalizeIndianPhone(phone)
    if (!/^[6-9]\d{9}$/.test(local)) {
      setError('Enter a valid 10-digit Indian mobile number')
      return
    }

    setError(null)
    setLoading(true)
    try {
      const normalized = `+91${local}`
      const result = await api.requestOtp(normalized)
      beginLogin(normalized, result)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not send the code. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen>
      <BrandHeader tagline="Borrow what you need. Lend what you don't." />

      <Card>
        <Text style={styles.heading}>Sign in or create an account</Text>
        <Body muted>We send a 6-digit code by SMS. No passwords to remember.</Body>

        <View style={styles.phoneRow}>
          <View style={styles.prefix}>
            <Text style={styles.prefixText}>+91</Text>
          </View>
          <View style={styles.phoneInput}>
            <TextField
              label="Mobile number"
              value={phone}
              onChangeText={(value) => {
                setPhone(value)
                if (error) setError(null)
              }}
              placeholder="98765 43210"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              maxLength={14}
              returnKeyType="go"
              onSubmitEditing={() => {
                void submit()
              }}
              error={error}
            />
          </View>
        </View>

        <PrimaryButton
          label="Send code"
          onPress={() => {
            void submit()
          }}
          loading={loading}
        />
      </Card>

      <Notice>
        By continuing you agree to our Terms and Privacy Policy. Your number is used only for
        sign-in and booking updates.
      </Notice>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Made for Indian neighbourhoods · English + हिन्दी</Text>
      </View>
    </Screen>
  )
}

const styles = {
  heading: { color: colors.text, ...typography.title },
  phoneRow: { flexDirection: 'row' as const, gap: spacing.sm, alignItems: 'flex-end' as const },
  prefix: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    height: 50,
    justifyContent: 'center' as const,
  },
  prefixText: { color: colors.text, fontSize: 16, fontWeight: '600' as const },
  phoneInput: { flex: 1 },
  footer: { marginTop: spacing.xl, alignItems: 'center' as const },
  footerText: { color: colors.textSubtle, ...typography.small },
}
