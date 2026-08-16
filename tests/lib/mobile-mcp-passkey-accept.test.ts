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
 * SUPERSEDES tests/lib/mobile-mcp-passkey-diagnostic.test.ts, which pinned the
 * refusal this change removes. Every case from that file survives here with the
 * expectation Jon's decision requires:
 *
 *   database session still resolves      -> 'prefers the database session'
 *   passkey told WHY (401 + message)     -> now ACCEPTED, see the first case
 *   'does not widen who can mint'        -> deliberately reversed
 *   unreadable cookie is invalid         -> 'still refuses an unreadable cookie'
 *   expired JWT is invalid               -> 'still refuses an EXPIRED JWT'
 *   no cookie is no session              -> 'still refuses when there is no cookie'
 *   decode that throws                   -> 'still refuses an unreadable cookie'
 *                                           (that case mocks a rejection)
 *
 * RESOLVED 2026-08-15: Jon approved accepting JWT sessions. A passkey user can
 * now mint a token, so the diagnostic refusal above is gone and these cases pin
 * the acceptance instead. The refusals that REMAIN refusals are the point of
 * the rest of this file: an expired JWT, an unreadable cookie, and a decode
 * that throws are all still 401.
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

const future2 = () => Math.floor(Date.now() / 1000) + 3600
const past2 = () => Math.floor(Date.now() / 1000) - 3600

describe('JWT (passkey) sessions may mint a mobile MCP token (task c9a38b36)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // No database Session row — this is the passkey shape.
    findUnique.mockResolvedValue(null)
  })

  it('resolves the user from a valid JWT instead of refusing', async () => {
    // The system already trusts a JWT for the equivalent job: GET
    // /api/v1/auth/mobile-session decodes one and issues a mobile session from
    // it. Refusing the same identity here was an accident of these two routes
    // being written against the database-session shape, not a security posture.
    decode.mockResolvedValue({ id: 'user-passkey', exp: future2() })

    const result = await resolveMobileSessionUser(req('a.jwt.cookie'))

    expect(result).toMatchObject({ ok: true, userId: 'user-passkey' })
  })

  it('still refuses an EXPIRED JWT', async () => {
    // Expired is not "signed in by another method" — it is expired.
    decode.mockResolvedValue({ id: 'user-passkey', exp: past2() })

    const result = await resolveMobileSessionUser(req('a.jwt.cookie'))

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('still refuses a JWT with no subject', async () => {
    decode.mockResolvedValue({ exp: future2() })

    expect(await resolveMobileSessionUser(req('a.jwt.cookie'))).toMatchObject({
      ok: false,
      status: 401,
    })
  })

  it('still refuses an unreadable cookie', async () => {
    decode.mockRejectedValue(new Error('bad signature'))

    expect(await resolveMobileSessionUser(req('garbage'))).toMatchObject({
      ok: false,
      status: 401,
    })
  })

  it('still refuses when there is no cookie at all', async () => {
    expect(await resolveMobileSessionUser(req())).toMatchObject({
      ok: false,
      status: 401,
    })
  })

  it('prefers the database session when one exists', async () => {
    // Apple/Google sign-in is unchanged; the JWT path is a fallback, not a
    // replacement, so a live row still wins and decode is never consulted.
    findUnique.mockResolvedValue({
      id: 's1',
      expires: new Date(Date.now() + 3600_000),
      user: { id: 'user-db' },
    })

    expect(await resolveMobileSessionUser(req('cookie'))).toMatchObject({
      ok: true,
      userId: 'user-db',
    })
    expect(decode).not.toHaveBeenCalled()
  })
})
