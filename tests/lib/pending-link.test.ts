/**
 * @vitest-environment node
 *
 * RED for task 842601f2 — the signed-out half of the connect callback.
 *
 * When the callback browser has no session, the state is the only thing naming
 * an owner, and an attacker minted it. So the grant must be PARKED rather than
 * spent: sealed into an HttpOnly cookie that only the browser which actually
 * received the callback holds, and redeemed after that browser proves who it
 * is. The attacker never holds the cookie, so they can never redeem it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/field-encryption', () => ({
  encryptField: (v: string) => `enc:${v}`,
  decryptField: (v: string) => (v.startsWith('enc:') ? v.slice(4) : null),
}))

import { sealPendingLink, openPendingLink } from '@/lib/sync/pending-link'
import { BRAND } from '@/lib/brand/config'

describe('pending integration link (task 842601f2)', () => {
  beforeEach(() => vi.stubEnv('NEXTAUTH_SECRET', 'test-secret'))
  afterEach(() => vi.unstubAllEnvs())

  it('round-trips the grant', () => {
    const sealed = sealPendingLink({ provider: 'github', code: 'gho_code', redirectUri: `https://${BRAND.domain}/cb` })

    expect(openPendingLink(sealed)).toEqual({
      provider: 'github',
      code: 'gho_code',
      redirectUri: `https://${BRAND.domain}/cb`,
    })
  })

  it('never carries the authorization code in the clear', () => {
    const sealed = sealPendingLink({ provider: 'google', code: 'super-secret-code' })

    expect(sealed).not.toContain('super-secret-code')
  })

  it('carries no user id — the redeemer is whoever signs in, not whoever started it', () => {
    const sealed = sealPendingLink({ provider: 'github', code: 'c' })

    expect(JSON.stringify(openPendingLink(sealed))).not.toContain('user')
  })

  it('refuses a tampered seal', () => {
    const sealed = sealPendingLink({ provider: 'github', code: 'gho_code' })
    const tampered = sealed.slice(0, -4) + 'aaaa'

    expect(openPendingLink(tampered)).toBeNull()
  })

  it('refuses a seal from a different server secret', () => {
    const sealed = sealPendingLink({ provider: 'github', code: 'gho_code' })
    vi.stubEnv('NEXTAUTH_SECRET', 'other-secret')

    expect(openPendingLink(sealed)).toBeNull()
  })

  it('refuses an expired seal — an OAuth code outlives one sign-in, not a session', () => {
    const sealed = sealPendingLink({ provider: 'github', code: 'gho_code' })
    vi.setSystemTime(Date.now() + 16 * 60 * 1000)

    expect(openPendingLink(sealed)).toBeNull()
    vi.useRealTimers()
  })

  it('refuses garbage without throwing', () => {
    expect(openPendingLink('')).toBeNull()
    expect(openPendingLink('not-a-seal')).toBeNull()
  })
})
