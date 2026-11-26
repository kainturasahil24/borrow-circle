/**
 * Indian mobile numbers only: +91 followed by 10 digits starting 6-9.
 * Numbers are always stored and compared in E.164 form.
 */
export const PHONE_REGEX = /^\+91[6-9]\d{9}$/

/** Accepts "+91 98765 43210", "09876543210", "9876543210" and returns E.164. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')

  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return `+${digits}`
}

export function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(phone)
}

/** +919876543210 -> +91******3210. Safe to show in admin lists and logs. */
export function maskPhone(phone: string): string {
  if (phone.length < 4) return '****'
  return `${phone.slice(0, 3)}******${phone.slice(-4)}`
}
