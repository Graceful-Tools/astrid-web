import { describe, it, expect } from 'vitest'
import {
  resolveAppleIdentity,
  isEmailVerified,
  appleAllowedAudiences,
} from '@/lib/auth/apple-identity'

/**
 * Locks the fix for the Apple Sign-In account-takeover: the handler used
 * `body.email || verifiedPayload.email`, so an attacker with their own valid
 * Apple token could supply a victim's email in the body, link their Apple
 * providerAccountId onto the victim's account, and mint a session for it.
 */
describe('resolveAppleIdentity', () => {
  it('uses ONLY the verified token email — never a caller-supplied one', () => {
    // The resolver does not even accept a body email parameter; this test
    // documents that the token claim is the sole source.
    const resolved = resolveAppleIdentity({
      sub: 'apple-sub-1',
      email: 'Attacker@Example.com',
      email_verified: 'true',
    })
    expect(resolved.email).toBe('attacker@example.com')
  })

  it('returns null email when the token has no email claim (caller must reject or account-match)', () => {
    const resolved = resolveAppleIdentity({ sub: 'apple-sub-2' })
    expect(resolved.email).toBeNull()
    expect(resolved.emailVerified).toBe(false)
  })

  it('treats empty/whitespace claim as missing', () => {
    expect(resolveAppleIdentity({ sub: 's', email: '  ' }).email).toBeNull()
  })

  it('emailVerified requires an affirmative claim (Apple sends string or boolean)', () => {
    expect(isEmailVerified(true)).toBe(true)
    expect(isEmailVerified('true')).toBe(true)
    expect(isEmailVerified(false)).toBe(false)
    expect(isEmailVerified('false')).toBe(false)
    expect(isEmailVerified(undefined)).toBe(false)
    // No truthy coercion: arbitrary strings are not verification.
    expect(isEmailVerified('1' as unknown as string)).toBe(false)
  })
})

describe('appleAllowedAudiences', () => {
  it('defaults to the iOS bundle id', () => {
    expect(appleAllowedAudiences(undefined)).toEqual(['Graceful-Tools-Inc.Astrid-App'])
    expect(appleAllowedAudiences('')).toEqual(['Graceful-Tools-Inc.Astrid-App'])
  })

  it('parses the comma-separated env override', () => {
    expect(appleAllowedAudiences('a.b.c, d.e.f')).toEqual(['a.b.c', 'd.e.f'])
  })
})
