/**
 * Shared visual language. Teal/green = trust + lending. Dark surfaces keep the
 * app comfortable at night and match the Phase 1 shell.
 */
export const colors = {
  background: '#0F172A',
  surface: '#134E4A',
  surfaceMuted: '#1E293B',
  border: '#0F766E',
  borderMuted: '#334155',
  primary: '#14B8A6',
  primaryDark: '#0F766E',
  primarySoft: '#CCFBF1',
  onPrimary: '#042F2E',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  dangerSurface: '#450A0A',
  overlay: 'rgba(15, 23, 42, 0.92)',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radii = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const

export const typography = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  subtitle: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13 },
  tiny: { fontSize: 11, letterSpacing: 0.6 },
} as const
