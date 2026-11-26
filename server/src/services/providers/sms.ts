import { logger } from '../../lib/logger'
import { maskPhone } from '../../lib/phone'

export type OtpSms = {
  phone: string
  template: 'LOGIN_OTP'
  code: string
  expiresInSeconds: number
}

export interface SmsProvider {
  readonly name: string
  sendOtp(message: OtpSms): Promise<void>
}

/**
 * Phase 2 has no live SMS credentials. The code is never logged; in local
 * development it is returned by the API as `devCode` instead (see env.ts).
 */
class MockSmsProvider implements SmsProvider {
  readonly name = 'mock'

  async sendOtp(message: OtpSms): Promise<void> {
    logger.info(
      { provider: this.name, phone: maskPhone(message.phone), template: message.template },
      'mock OTP delivery (code withheld from logs)',
    )
  }
}

export const smsProvider: SmsProvider = new MockSmsProvider()
