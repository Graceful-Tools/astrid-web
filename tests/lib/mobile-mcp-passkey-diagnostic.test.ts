/**
 * Task c9a38b36 — a passkey user asking for a mobile MCP token was told
 * "Invalid session", which is false.
 *
 * Astrid has two session shapes: passkey/WebAuthn sign-in issues a JWT
 * (`strategy: 'jwt'`), Apple/Google mobile sign-in writes a database Session
 * row. `GET /api/v1/auth/mobile-session` accepts both; the mobile-mcp-token
 * routes only understand database sessions, so a passkey cookie finds no row
 * and fell through to "Unauthorized - Invalid session".
 *
 * That user IS signed in. The message sent them hunting a broken integration
 * rather than an unsupported sign-in method, and neither route logged enough to
 * tell the cases apart from a support report. Production has 33 registered
 * authenticators, so the audience is real.
 *
 * THIS DOES NOT WIDEN WHO CAN MINT. Whether JWT sessions should be able to mint
 * an MCP token is a separate decision and is still open; these cases pin only
 * that the refusal is truthful — a 401 either way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: { session: { findUnique, delete: vi.fn() } },
}))

const decode = vi.hoisted(() => vi.fn())
vi.mock('next-auth/jwt', () => ({ decode }))

import { resolveMobileSessionUser } from '@/lib/mobile-mcp-token'

/** A request carrying the given session cookie value, or none. */
function req(cookieValue?: string) {
  return {
    cookies: {
      get: (name: string) =>
        cookieValue && name === 'next-auth.session-token'
          ? { value: cookieValue }
          : undefined,
    },
  } as never
}

const future = () => Math.floor(Date.now() / 1000) + 3600
const past = () => Math.floor(Date.now() / 1000) - 3600

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue(null)
  decode.mockResolvedValue(null)
})

describe('resolveMobileSessionUser diagnostics (task c9a38b36)', () => {
  it('still resolves a database session normally', async () => {
    findUnique.mockResolvedValue({
      id: 's1',
      expires: new Date(Date.now() + 3600_000),
      user: { id: 'user-1' },
    })

    expect(await resolveMobileSessionUser(req('db-token'))).toEqual({
      ok: true,
      userId: 'user-1',
    })
  })

  it('tells a passkey user WHY, instead of claiming their session is invalid', async () => {
    decode.mockResolvedValue({ id: 'user-1', exp: future() })

    const result = await resolveMobileSessionUser(req('a-valid-jwt'))

    expect(result).toMatchObject({ ok: false, status: 401 })
    if (result.ok) throw new Error('unreachable')
    // The point of the task: the old message sent them looking for a broken
    // integration. This one names the actual constraint.
    expect(result.error).toMatch(/Apple or Google/i)
    expect(result.error).not.toMatch(/Invalid session/i)
  })

  it('still refuses — this does not widen who can mint a token', async () => {
    decode.mockResolvedValue({ id: 'user-1', exp: future() })

    const result = await resolveMobileSessionUser(req('a-valid-jwt'))

    // Whether JWT sessions SHOULD be able to mint is an open decision. Until
    // it is made, a passkey user gets a clear 401, not a token.
    expect(result.ok).toBe(false)
  })

  it('calls an unreadable cookie invalid, because that is what it is', async () => {
    decode.mockResolvedValue(null)

    const result = await resolveMobileSessionUser(req('garbage'))

    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/Invalid session/i)
  })

  it('treats an EXPIRED jwt as invalid rather than as wrong-sign-in-method', async () => {
    // Expired is not "you used a passkey", it is "sign in again". Telling an
    // expired user to switch sign-in methods would be a new wrong answer.
    decode.mockResolvedValue({ id: 'user-1', exp: past() })

    const result = await resolveMobileSessionUser(req('stale-jwt'))

    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/Invalid session/i)
  })

  it('still reports no cookie as no session', async () => {
    const result = await resolveMobileSessionUser(req())

    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/No session/i)
    expect(decode).not.toHaveBeenCalled()
  })

  it('survives a decode that throws', async () => {
    decode.mockRejectedValue(new Error('bad secret'))

    const result = await resolveMobileSessionUser(req('whatever'))

    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/Invalid session/i)
  })
})
