/**
 * GitHub Copilot per-user OAuth — Phase 1 (see docs/COPILOT_SDK_INTEGRATION_PLAN.md).
 *
 * Covers the security-load-bearing bits: HMAC state round-trip + rejection,
 * provider-tag isolation, token-response parsing (OAuth App vs GitHub App
 * shapes), and the transparent-refresh logic in copilotTokenFor.
 */
import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { encryptField } from '@/lib/field-encryption'
import {
  mintCopilotOAuthState,
  verifyCopilotOAuthState,
  copilotOAuthConfigured,
  exchangeCopilotCode,
  copilotTokenFor,
} from '@/lib/copilot/oauth'

// setup.ts sets NEXTAUTH_SECRET='test-secret' and a valid ENCRYPTION_KEY.
const SECRET = 'test-secret'

describe('Copilot OAuth state (HMAC, provider-tagged)', () => {
  it('round-trips the userId', () => {
    const state = mintCopilotOAuthState('user-123')
    expect(verifyCopilotOAuthState(state)).toBe('user-123')
  })

  it('rejects a tampered signature', () => {
    const state = mintCopilotOAuthState('user-123')
    const raw = Buffer.from(state, 'base64url').toString()
    const tampered = Buffer.from(raw.slice(0, -1) + (raw.at(-1) === 'a' ? 'b' : 'a')).toString('base64url')
    expect(verifyCopilotOAuthState(tampered)).toBeNull()
  })

  it('rejects an expired state', () => {
    vi.useFakeTimers()
    try {
      const state = mintCopilotOAuthState('user-123')
      vi.advanceTimersByTime(11 * 60 * 1000) // TTL is 10 min
      expect(verifyCopilotOAuthState(state)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects a validly-signed state from a DIFFERENT provider tag (no cross-provider replay)", () => {
    // A state minted with the same secret but the 'sync' tag must not verify here.
    const payload = `sync.user-123.${Date.now() + 100_000}`
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex')
    const foreign = Buffer.from(`${payload}.${sig}`).toString('base64url')
    expect(verifyCopilotOAuthState(foreign)).toBeNull()
  })

  it('rejects garbage', () => {
    expect(verifyCopilotOAuthState('not-a-real-state')).toBeNull()
    expect(verifyCopilotOAuthState('')).toBeNull()
  })
})

describe('copilotOAuthConfigured', () => {
  const prev = { id: process.env.GITHUB_COPILOT_CLIENT_ID, secret: process.env.GITHUB_COPILOT_CLIENT_SECRET }
  afterEach(() => {
    process.env.GITHUB_COPILOT_CLIENT_ID = prev.id
    process.env.GITHUB_COPILOT_CLIENT_SECRET = prev.secret
  })

  it('is true only when both client id and secret are set', () => {
    process.env.GITHUB_COPILOT_CLIENT_ID = 'iv1.abc'
    process.env.GITHUB_COPILOT_CLIENT_SECRET = 'shhh'
    expect(copilotOAuthConfigured()).toBe(true)

    delete process.env.GITHUB_COPILOT_CLIENT_SECRET
    expect(copilotOAuthConfigured()).toBe(false)
  })
})

describe('exchangeCopilotCode', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('parses an OAuth App response (no expiry, no refresh)', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'gho_abc', scope: 'read:user,repo', token_type: 'bearer' }),
    })
    const token = await exchangeCopilotCode('code123')
    expect(token).toMatchObject({ accessToken: 'gho_abc', scopes: ['read:user', 'repo'] })
    expect(token?.refreshToken).toBeUndefined()
    expect(token?.expiresAt).toBeUndefined()
  })

  it('parses a GitHub App response (expiry + refresh token)', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        access_token: 'ghu_abc',
        refresh_token: 'ghr_xyz',
        expires_in: 28800,
        scope: '',
      }),
    })
    const token = await exchangeCopilotCode('code123')
    expect(token?.accessToken).toBe('ghu_abc')
    expect(token?.refreshToken).toBe('ghr_xyz')
    expect(token?.expiresAt).toBeInstanceOf(Date)
  })

  it('returns null when GitHub returns no access_token', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({ error: 'bad_verification_code' }) })
    expect(await exchangeCopilotCode('code123')).toBeNull()
  })
})

describe('copilotTokenFor (transparent refresh)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    ;(prisma as any).copilotCredential = {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    }
  })
  afterEach(() => vi.unstubAllGlobals())

  it('returns null when the user has no credential', async () => {
    ;(prisma as any).copilotCredential.findUnique.mockResolvedValue(null)
    expect(await copilotTokenFor('u1')).toBeNull()
  })

  it('returns null when the credential is revoked', async () => {
    ;(prisma as any).copilotCredential.findUnique.mockResolvedValue({
      accessToken: encryptField('gho_live'),
      revokedAt: new Date(),
    })
    expect(await copilotTokenFor('u1')).toBeNull()
  })

  it('returns the decrypted token when present and unexpired', async () => {
    ;(prisma as any).copilotCredential.findUnique.mockResolvedValue({
      accessToken: encryptField('gho_live'),
      refreshToken: null,
      expiresAt: null,
      revokedAt: null,
    })
    expect(await copilotTokenFor('u1')).toBe('gho_live')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes when expired and a refresh token is on file', async () => {
    ;(prisma as any).copilotCredential.findUnique.mockResolvedValue({
      accessToken: encryptField('ghu_old'),
      refreshToken: encryptField('ghr_refresh'),
      expiresAt: new Date(Date.now() - 60_000), // already expired
      githubLogin: 'octocat',
      revokedAt: null,
    })
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800, scope: '' }),
    })

    const token = await copilotTokenFor('u1')
    expect(token).toBe('ghu_new')
    // refresh call went to GitHub's token endpoint with grant_type=refresh_token
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('ghr_refresh')
    // and the refreshed token was persisted
    expect((prisma as any).copilotCredential.upsert).toHaveBeenCalledTimes(1)
  })

  it('returns null when expired with no refresh token (needs re-auth)', async () => {
    ;(prisma as any).copilotCredential.findUnique.mockResolvedValue({
      accessToken: encryptField('ghu_old'),
      refreshToken: null,
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null,
    })
    expect(await copilotTokenFor('u1')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
