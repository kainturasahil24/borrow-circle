const UNIT_SECONDS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const

/** Parses "15m", "900s", "2h", "7d" into seconds. Throws at boot on bad config. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim().toLowerCase())
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use a number followed by s, m, h or d.`)
  }
  const amount = Number(match[1])
  const unit = match[2] as keyof typeof UNIT_SECONDS
  return amount * UNIT_SECONDS[unit]
}
