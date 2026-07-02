/**
 * @vitest-environment node
 *
 * External sync providers (GitHub Issues / Google Tasks) — the deterministic
 * server-side pieces: HMAC OAuth state, webhook signature verification, and
 * OAuth client configuration/fallback. The sync EXECUTION lives on the client
 * (iOS), which has its own suite (SyncProviderLogicTests).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/field-encryption', () => ({
  encryptField: (v: string) => `enc:${v}`,
  decryptField: (v: string) => v.replace(/^enc:/, ''),
}))

import { mintOAuthState, verifyOAuthState, verifyWebhookSignature, githubSyncConfigured } from '@/lib/sync/github'
import { googleAuthorizeURL, googleSyncConfigured } from '@/lib/sync/google'

describe('OAuth state (HMAC, shared by GitHub + Google connect flows)', () => {
  beforeEach(() => vi.stubEnv('NEXTAUTH_SECRET', 'test-secret'))
  afterEach(() => vi.unstubAllEnvs())

  it('round-trips the userId', () => {
    const state = mintOAuthState('user-123')
    expect(verifyOAuthState(state)).toBe('user-123')
  })

  it('rejects an expired state', () => {
    const expires = Date.now() - 1000
    const payload = `user-123.${expires}`
    const sig = crypto.createHmac('sha256', 'test-secret').update(payload).digest('hex')
    const state = Buffer.from(`${payload}.${sig}`).toString('base64url')
    expect(verifyOAuthState(state)).toBeNull()
  })

  it('rejects a tampered userId (signature mismatch)', () => {
    const state = mintOAuthState('user-123')
    const decoded = Buffer.from(state, 'base64url').toString()
    const tampered = Buffer.from(decoded.replace('user-123', 'user-666')).toString('base64url')
    expect(verifyOAuthState(tampered)).toBeNull()
  })

  it('rejects a state signed with a different secret', () => {
    const state = mintOAuthState('user-123')
    vi.stubEnv('NEXTAUTH_SECRET', 'other-secret')
    expect(verifyOAuthState(state)).toBeNull()
  })

  it('rejects garbage without throwing', () => {
    expect(verifyOAuthState('not-a-state')).toBeNull()
    expect(verifyOAuthState('')).toBeNull()
    expect(verifyOAuthState(Buffer.from('a.b').toString('base64url'))).toBeNull()
  })
})

describe('GitHub issues webhook signature', () => {
  const SECRET = 'janes-webhook-secret'
  const body = JSON.stringify({ action: 'opened', issue: { number: 1 } })
  const sign = (secret: string, payload: string) =>
    'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex')

  beforeEach(() => vi.stubEnv('GITHUB_SYNC_WEBHOOK_SECRET', SECRET))
  afterEach(() => vi.unstubAllEnvs())

  it('accepts a correctly signed payload', () => {
    expect(verifyWebhookSignature(body, sign(SECRET, body))).toBe(true)
  })

  it('rejects a payload signed with the wrong secret', () => {
    expect(verifyWebhookSignature(body, sign('attacker', body))).toBe(false)
  })

  it('rejects a modified body under a valid signature', () => {
    const sig = sign(SECRET, body)
    expect(verifyWebhookSignature(body + 'x', sig)).toBe(false)
  })

  it('rejects missing signature header', () => {
    expect(verifyWebhookSignature(body, null)).toBe(false)
  })

  it('rejects malformed signatures without throwing (length mismatch)', () => {
    expect(verifyWebhookSignature(body, 'sha256=short')).toBe(false)
    expect(verifyWebhookSignature(body, 'garbage')).toBe(false)
  })

  it('rejects everything when the secret is unset', () => {
    vi.stubEnv('GITHUB_SYNC_WEBHOOK_SECRET', '')
    expect(verifyWebhookSignature(body, sign(SECRET, body))).toBe(false)
  })
})

describe('OAuth client configuration', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('github requires its own OAuth app credentials', () => {
    vi.stubEnv('GITHUB_SYNC_CLIENT_ID', '')
    vi.stubEnv('GITHUB_SYNC_CLIENT_SECRET', '')
    expect(githubSyncConfigured()).toBe(false)
    vi.stubEnv('GITHUB_SYNC_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_SYNC_CLIENT_SECRET', 'secret')
    expect(githubSyncConfigured()).toBe(true)
  })

  it('google falls back to the login client (GOOGLE_CLIENT_ID/SECRET)', () => {
    vi.stubEnv('GOOGLE_SYNC_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_SYNC_CLIENT_SECRET', '')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'login-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'login-secret')
    expect(googleSyncConfigured()).toBe(true)
    const url = googleAuthorizeURL('the-state', 'https://astrid.cc/api/v1/integrations/google/callback')
    expect(url).toContain('client_id=login-id')
  })

  it('google prefers the dedicated sync client when set', () => {
    vi.stubEnv('GOOGLE_SYNC_CLIENT_ID', 'sync-id')
    vi.stubEnv('GOOGLE_SYNC_CLIENT_SECRET', 'sync-secret')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'login-id')
    const url = googleAuthorizeURL('the-state', 'https://astrid.cc/cb')
    expect(url).toContain('client_id=sync-id')
  })

  it('google authorize URL requests offline access with the tasks scope', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'login-id')
    const url = new URL(googleAuthorizeURL('the-state', 'https://astrid.cc/cb'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/tasks')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('state')).toBe('the-state')
    expect(url.searchParams.get('redirect_uri')).toBe('https://astrid.cc/cb')
  })
})
