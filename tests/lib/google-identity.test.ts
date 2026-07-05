import { describe, it, expect } from 'vitest'
import {
  verifyGoogleIdentity,
  googleAllowedAudiences,
  isGoogleEmailVerified,
} from '@/lib/auth/google-identity'

const OURS = 'our-client.apps.googleusercontent.com'
const AUD = [OURS]

describe('verifyGoogleIdentity', () => {
  it('accepts a token for our own client with a verified email', () => {
    const r = verifyGoogleIdentity(
      { email: 'User@Example.com', email_verified: true, sub: 's', aud: OURS }, AUD)
    expect(r.ok).toBe(true)
    expect(r.email).toBe('user@example.com')
  })

  it('REJECTS a token minted for another OAuth client (the replay attack)', () => {
    const r = verifyGoogleIdentity(
      { email: 'victim@example.com', email_verified: true, sub: 's', aud: 'attacker-app.apps.googleusercontent.com' }, AUD)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('aud_mismatch')
  })

  it('rejects an unverified email even with correct aud', () => {
    const r = verifyGoogleIdentity(
      { email: 'x@example.com', email_verified: false, sub: 's', aud: OURS }, AUD)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('email_unverified')
  })

  it('rejects missing aud/email/sub', () => {
    expect(verifyGoogleIdentity({ email: 'x@e.com', email_verified: true, sub: 's' }, AUD).reason).toBe('aud_mismatch')
    expect(verifyGoogleIdentity({ email_verified: true, sub: 's', aud: OURS }, AUD).reason).toBe('missing_email')
    expect(verifyGoogleIdentity({ email: 'x@e.com', email_verified: true, aud: OURS }, AUD).reason).toBe('missing_sub')
  })

  it('accepts string "true" for email_verified (Google sends a string)', () => {
    expect(isGoogleEmailVerified('true')).toBe(true)
    expect(isGoogleEmailVerified('false')).toBe(false)
    const r = verifyGoogleIdentity({ email: 'x@e.com', email_verified: 'true', sub: 's', aud: OURS }, AUD)
    expect(r.ok).toBe(true)
  })
})

describe('googleAllowedAudiences', () => {
  it('defaults to the iOS client + web client id', () => {
    expect(googleAllowedAudiences(undefined, 'web-client-123')).toContain('web-client-123')
    expect(googleAllowedAudiences(undefined, undefined).length).toBeGreaterThanOrEqual(1)
  })
  it('honors the comma-separated env override', () => {
    expect(googleAllowedAudiences('a,b,c', 'ignored')).toEqual(['a', 'b', 'c'])
  })
})
