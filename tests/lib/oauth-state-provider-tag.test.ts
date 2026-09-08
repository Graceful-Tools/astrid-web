/**
 * @vitest-environment node
 *
 * RED for task 842601f2.
 *
 * `lib/copilot/oauth.ts` tags its state with the provider — its own comment
 * says why: "namespaces state so it can't be replayed on another provider's
 * callback". The GitHub and Google connect flows share the UNTAGGED helper in
 * `lib/sync/github.ts`, so one mint produces a value both callbacks accept.
 * The three flows should agree on the same rule, from one implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/field-encryption', () => ({
  encryptField: (v: string) => `enc:${v}`,
  decryptField: (v: string) => v.replace(/^enc:/, ''),
}))

import { mintOAuthState, verifyOAuthState } from '@/lib/sync/oauth-state'

describe('OAuth connect state is bound to one provider (task 842601f2)', () => {
  beforeEach(() => vi.stubEnv('NEXTAUTH_SECRET', 'test-secret'))
  afterEach(() => vi.unstubAllEnvs())

  it('round-trips the userId for the provider it was minted for', () => {
    expect(verifyOAuthState(mintOAuthState('user-123', 'github'), 'github')).toBe('user-123')
    expect(verifyOAuthState(mintOAuthState('user-123', 'google'), 'google')).toBe('user-123')
    expect(verifyOAuthState(mintOAuthState('user-123', 'copilot'), 'copilot')).toBe('user-123')
  })

  it('refuses a GitHub state replayed at the Google callback, and the reverse', () => {
    expect(verifyOAuthState(mintOAuthState('user-123', 'github'), 'google')).toBeNull()
    expect(verifyOAuthState(mintOAuthState('user-123', 'google'), 'github')).toBeNull()
  })

  it('refuses a Copilot state replayed at either sync callback', () => {
    const copilot = mintOAuthState('user-123', 'copilot')
    expect(verifyOAuthState(copilot, 'github')).toBeNull()
    expect(verifyOAuthState(copilot, 'google')).toBeNull()
  })

  it('refuses the legacy untagged state that either callback used to accept', () => {
    const expires = Date.now() + 60_000
    const payload = `user-123.${expires}`
    const sig = crypto.createHmac('sha256', 'test-secret').update(payload).digest('hex')
    const legacy = Buffer.from(`${payload}.${sig}`).toString('base64url')

    expect(verifyOAuthState(legacy, 'github')).toBeNull()
    expect(verifyOAuthState(legacy, 'google')).toBeNull()
  })

  it('rejects an expired state', () => {
    const expires = Date.now() - 1000
    const payload = `github.user-123.${expires}`
    const sig = crypto.createHmac('sha256', 'test-secret').update(payload).digest('hex')
    const state = Buffer.from(`${payload}.${sig}`).toString('base64url')

    expect(verifyOAuthState(state, 'github')).toBeNull()
  })

  it('rejects a tampered userId (signature mismatch)', () => {
    const decoded = Buffer.from(mintOAuthState('user-123', 'github'), 'base64url').toString()
    const tampered = Buffer.from(decoded.replace('user-123', 'user-666')).toString('base64url')

    expect(verifyOAuthState(tampered, 'github')).toBeNull()
  })

  it('rejects a state signed with a different secret', () => {
    const state = mintOAuthState('user-123', 'github')
    vi.stubEnv('NEXTAUTH_SECRET', 'other-secret')

    expect(verifyOAuthState(state, 'github')).toBeNull()
  })

  it('rejects garbage without throwing', () => {
    expect(verifyOAuthState('not-a-state', 'github')).toBeNull()
    expect(verifyOAuthState('', 'google')).toBeNull()
    expect(verifyOAuthState(Buffer.from('a.b').toString('base64url'), 'copilot')).toBeNull()
  })
})
