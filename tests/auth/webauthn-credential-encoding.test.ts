import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The stored-credential encoding must survive the @simplewebauthn/server v9 -> v13 upgrade.
 *
 * v13 changed credential ids from raw bytes to base64url STRINGS at the library boundary:
 * `allowCredentials[].id`, `excludeCredentials[].id`, `registrationInfo.credential.id`, and
 * the `credential` argument to `verifyAuthenticationResponse` (formerly `authenticator`).
 *
 * The `Authenticator.credentialID` COLUMN already held base64url, so the upgrade removes a
 * decode/re-encode round trip rather than changing what is stored. That is the whole safety
 * argument for upgrading without a data migration, and it is invisible in the diff — which is
 * exactly why it is pinned here.
 *
 * WHAT BREAKS IF THIS IS WRONG: nothing throws. Registration keeps working, and every passkey
 * created before the upgrade simply stops matching at sign-in — users are locked out of an
 * authentication method with no error to trace it by. A type error would have been the kind
 * outcome; this is the unkind one.
 */

const mockPrisma = {
  user: { findUnique: vi.fn() },
  authenticator: { findMany: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// A credential id exactly as an existing row holds it: base64url, no padding.
const STORED_CREDENTIAL_ID = 'AQIDBAUGBwgJCgsMDQ4PEA'

describe('passkey credential encoding across the v13 upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers an EXISTING stored credential id back unchanged at sign-in (task: deps @simplewebauthn 13)', async () => {
    const { getAuthenticationOptions } = await import('@/lib/webauthn')

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'someone@example.com',
      authenticators: [
        { credentialID: STORED_CREDENTIAL_ID, transports: 'internal,hybrid' },
      ],
    })

    const options = await getAuthenticationOptions('someone@example.com')

    // The id the browser is asked for must be the id in the column, byte for byte. Decoding it
    // to a Buffer first (what v9 needed) would serialize to a different string here and no
    // existing passkey would be offered.
    expect(options.allowCredentials?.[0]?.id).toBe(STORED_CREDENTIAL_ID)
    expect(options.allowCredentials?.[0]?.transports).toEqual(['internal', 'hybrid'])
  })

  it('excludes an EXISTING stored credential id unchanged when adding a second passkey', async () => {
    const { getRegistrationOptions } = await import('@/lib/webauthn')

    mockPrisma.authenticator.findMany.mockResolvedValue([
      { credentialID: STORED_CREDENTIAL_ID, transports: 'internal' },
    ])

    const options = await getRegistrationOptions('user-1', 'someone@example.com')

    // If this drifts, the authenticator is never told it already holds this credential and
    // silently enrolls a duplicate.
    expect(options.excludeCredentials?.[0]?.id).toBe(STORED_CREDENTIAL_ID)
  })

  it('round-trips: a base64url id is what both the column and the library speak', () => {
    // The invariant the two tests above depend on, stated directly. v9 stored
    // `Buffer.from(rawBytes).toString('base64url')`; v13 hands back that same string already
    // encoded, so a row written by either version reads identically.
    const rawBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(Buffer.from(rawBytes).toString('base64url')).toBe(STORED_CREDENTIAL_ID)
  })
})
