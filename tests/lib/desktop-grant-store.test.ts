/**
 * RED for the storage half of desktop hand-off sign-in.
 *
 * A hand-off code is a bearer credential that exchanges into a full session,
 * so it gets the same treatment this repo already settled on for OAuth codes
 * and tokens (task 0845cf1c): hashed at rest, single-use, short-lived. The
 * difference from the OAuth path is that redemption here mints a first-party
 * session rather than a scoped access token, which is exactly why it must not
 * share a table with third-party authorization codes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const grantCreate = vi.hoisted(() => vi.fn())
const grantUpdateMany = vi.hoisted(() => vi.fn())
const grantFindUnique = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    desktopAuthGrant: {
      create: grantCreate,
      updateMany: grantUpdateMany,
      findUnique: grantFindUnique,
    },
    user: { findUnique: userFindUnique },
  },
}))

const { createDesktopGrant, redeemDesktopGrant } = await import('@/lib/auth/desktop-grant-store')
const { hashToken } = await import('@/lib/oauth/oauth-token-manager')
const { desktopClientFor } = await import('@/lib/auth/desktop-handoff')

const WINDOWS = desktopClientFor('windows')!
const NOW = new Date('2026-09-07T12:00:00Z')
const USER = { id: 'user-1', email: 'a@example.test', name: 'A', image: null }

/** A real PKCE pair, so the S256 check is exercised rather than stubbed. */
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = (await import('crypto')).createHash('sha256').update(VERIFIER).digest('base64url')

beforeEach(() => {
  vi.clearAllMocks()
  grantCreate.mockResolvedValue({})
  grantUpdateMany.mockResolvedValue({ count: 1 })
  grantFindUnique.mockResolvedValue({
    userId: 'user-1',
    client: 'windows',
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
  })
  userFindUnique.mockResolvedValue(USER)
})

describe('creating a grant', () => {
  it('returns the plaintext code and stores only its hash', async () => {
    const code = await createDesktopGrant({
      userId: 'user-1',
      client: WINDOWS,
      codeChallenge: CHALLENGE,
      now: NOW,
    })

    const stored = grantCreate.mock.calls[0][0].data
    expect(stored.code).toBe(hashToken(code))
    expect(stored.code).not.toBe(code)
  })

  it('records who it is for, which app, and when it dies', async () => {
    await createDesktopGrant({
      userId: 'user-1',
      client: WINDOWS,
      codeChallenge: CHALLENGE,
      now: NOW,
    })

    const stored = grantCreate.mock.calls[0][0].data
    expect(stored.userId).toBe('user-1')
    expect(stored.client).toBe('windows')
    expect(stored.codeChallenge).toBe(CHALLENGE)
    expect(stored.codeChallengeMethod).toBe('S256')
    expect(stored.expiresAt.toISOString()).toBe('2026-09-07T12:05:00.000Z')
    expect(stored.usedAt ?? null).toBeNull()
  })
})

describe('redeeming a grant', () => {
  it('hands back the user for a correct verifier', async () => {
    const result = await redeemDesktopGrant({
      code: 'astrid_desktop_abc',
      client: WINDOWS,
      codeVerifier: VERIFIER,
      now: NOW,
    })
    expect(result).toEqual({ ok: true, user: USER })
  })

  it('resolves the user here, so the route needs no database of its own', async () => {
    await redeemDesktopGrant({
      code: 'astrid_desktop_abc',
      client: WINDOWS,
      codeVerifier: VERIFIER,
      now: NOW,
    })
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    )
  })

  it('reports a deleted account distinctly from a bad code', async () => {
    // The account can go away between the grant and the exchange. The app
    // should be told to sign in again, not that its code was malformed.
    userFindUnique.mockResolvedValue(null)
    expect(
      await redeemDesktopGrant({
        code: 'astrid_desktop_abc',
        client: WINDOWS,
        codeVerifier: VERIFIER,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'account-missing' })
  })

  it('claims the row atomically, so two racing redemptions cannot both win', async () => {
    // A find-then-update would leave a window where both callers see usedAt
    // null. The guard has to be in the WHERE clause of the write itself.
    await redeemDesktopGrant({
      code: 'astrid_desktop_abc',
      client: WINDOWS,
      codeVerifier: VERIFIER,
      now: NOW,
    })

    const where = grantUpdateMany.mock.calls[0][0].where
    expect(where.code).toBe(hashToken('astrid_desktop_abc'))
    expect(where.client).toBe('windows')
    expect(where.usedAt).toBeNull()
    expect(where.expiresAt).toEqual({ gt: NOW })
    expect(grantUpdateMany.mock.calls[0][0].data.usedAt).toEqual(NOW)
  })

  it('refuses when the claim matched nothing — used, expired, or never existed', async () => {
    grantUpdateMany.mockResolvedValue({ count: 0 })
    const result = await redeemDesktopGrant({
      code: 'astrid_desktop_abc',
      client: WINDOWS,
      codeVerifier: VERIFIER,
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
    // Nothing was claimed, so nothing should have been read back.
    expect(grantFindUnique).not.toHaveBeenCalled()
  })

  it('refuses a wrong verifier, and burns the code doing so', async () => {
    // Deliberate: the claim happens before verification, mirroring the WebAuthn
    // challenge decision in this repo (task 1a52195f). If a wrong verifier
    // arrives, the code reached someone who should not have it — any local
    // program can register the URL scheme — so it must not survive to be
    // guessed at again.
    const result = await redeemDesktopGrant({
      code: 'astrid_desktop_abc',
      client: WINDOWS,
      codeVerifier: 'w'.repeat(64),
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
    expect(grantUpdateMany).toHaveBeenCalledTimes(1)
    expect(grantUpdateMany.mock.calls[0][0].data.usedAt).toEqual(NOW)
  })

  it('refuses a verifier that is too short to be PKCE', async () => {
    expect(
      await redeemDesktopGrant({
        code: 'astrid_desktop_abc',
        client: WINDOWS,
        codeVerifier: 'short',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses a stored grant whose method is not S256', async () => {
    // Defence in depth: the grant route already refuses `plain`, but a row
    // that somehow carries one must never verify by string equality here.
    grantFindUnique.mockResolvedValue({
      userId: 'user-1',
      client: 'windows',
      codeChallenge: VERIFIER,
      codeChallengeMethod: 'plain',
    })
    expect(
      await redeemDesktopGrant({
        code: 'astrid_desktop_abc',
        client: WINDOWS,
        codeVerifier: VERIFIER,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'invalid' })
  })
})
