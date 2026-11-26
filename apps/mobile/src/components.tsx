import React, { type ReactNode } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { colors, radii, spacing, typography } from './theme'

export function Screen({
  children,
  scroll = true,
}: {
  children: ReactNode
  scroll?: boolean
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={styles.content}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export function BrandHeader({ tagline }: { tagline?: string }) {
  return (
    <View style={styles.brand}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>BC</Text>
      </View>
      <Text style={styles.brandName}>Borrow Circle</Text>
      {tagline ? <Text style={styles.brandTagline}>{tagline}</Text> : null}
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.bodyMuted]}>{children}</Text>
}

type TextFieldProps = TextInputProps & { label: string; hint?: string; error?: string | null }

/**
 * Forwarded ref lets OTP screens re-focus the input after an error. React Native
 * 0.87+ (Strict TypeScript API) types the ref as an instance type, so derive it
 * from the component instead of naming `TextInput` directly.
 */
export const TextField = React.forwardRef<
  React.ComponentRef<typeof TextInput>,
  TextFieldProps
>(function TextField({ label, hint, error, style, ...inputProps }, ref) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textSubtle}
        {...inputProps}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  )
})

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: {
  label: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const isDisabled = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.onPrimary : colors.primarySoft}
        />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant !== 'primary' && styles.buttonLabelSecondary,
            variant === 'danger' && styles.buttonLabelDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

export function LinkButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8}>
      <Text style={[styles.link, disabled && styles.linkDisabled]}>{label}</Text>
    </Pressable>
  )
}

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const badgeColors: Record<BadgeTone, { bg: string; text: string }> = {
  success: { bg: 'rgba(52, 211, 153, 0.14)', text: colors.success },
  warning: { bg: 'rgba(251, 191, 36, 0.14)', text: colors.warning },
  danger: { bg: 'rgba(248, 113, 113, 0.14)', text: colors.danger },
  neutral: { bg: 'rgba(148, 163, 184, 0.14)', text: colors.textMuted },
  info: { bg: 'rgba(20, 184, 166, 0.16)', text: colors.primary },
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const palette = badgeColors[tone]
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.text }]}>{label}</Text>
    </View>
  )
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode
  tone?: 'info' | 'success' | 'warning' | 'danger'
}) {
  const toneStyles = {
    info: { border: colors.border, bg: 'rgba(20, 184, 166, 0.10)', text: colors.primarySoft },
    success: { border: colors.success, bg: 'rgba(52, 211, 153, 0.10)', text: '#D1FAE5' },
    warning: { border: colors.warning, bg: 'rgba(251, 191, 36, 0.10)', text: '#FEF3C7' },
    danger: { border: colors.danger, bg: colors.dangerSurface, text: '#FECACA' },
  }[tone]

  return (
    <View style={[styles.notice, { borderColor: toneStyles.border, backgroundColor: toneStyles.bg }]}>
      <Text style={[styles.noticeText, { color: toneStyles.text }]}>{children}</Text>
    </View>
  )
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  brand: { gap: spacing.sm, marginBottom: spacing.sm },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { color: colors.onPrimary, fontWeight: '800', fontSize: 18 },
  brandName: { color: colors.text, ...typography.display },
  brandTagline: { color: colors.textMuted, ...typography.body },
  card: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  sectionTitle: { color: colors.text, ...typography.title },
  body: { color: colors.text, ...typography.body },
  bodyMuted: { color: colors.textMuted },
  field: { gap: spacing.xs },
  label: { color: colors.textMuted, ...typography.small, fontWeight: '600' },
  input: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, ...typography.small },
  hint: { color: colors.textSubtle, ...typography.small },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.lg - 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { color: colors.onPrimary, ...typography.subtitle },
  buttonLabelSecondary: { color: colors.primarySoft },
  buttonLabelDanger: { color: colors.danger },
  link: { color: colors.primary, ...typography.body, fontWeight: '600' },
  linkDisabled: { color: colors.textSubtle },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  badgeText: { ...typography.tiny, fontWeight: '700', textTransform: 'uppercase' },
  notice: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  noticeText: { ...typography.small, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
