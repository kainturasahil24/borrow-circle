import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider, useAuth } from './src/auth'
import { HomeScreen } from './src/screens/HomeScreen'
import { OtpScreen } from './src/screens/OtpScreen'
import { PhoneScreen } from './src/screens/PhoneScreen'
import { colors, spacing, typography } from './src/theme'

/**
 * Phase 2 navigation is intentionally minimal: sign-in (phone → OTP) or the
 * signed-in home. A tab navigator with listings/chat/contracts arrives in later
 * phases.
 */
function Root() {
  const { status, pendingPhone } = useAuth()

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <View style={styles.mark}>
          <Text style={styles.markText}>BC</Text>
        </View>
        <Text style={styles.title}>Borrow Circle</Text>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  if (status === 'signedIn') return <HomeScreen />
  if (pendingPhone) return <OtpScreen />
  return <PhoneScreen />
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Root />
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: colors.onPrimary, fontSize: 24, fontWeight: '800' },
  title: { color: colors.text, ...typography.title },
})
