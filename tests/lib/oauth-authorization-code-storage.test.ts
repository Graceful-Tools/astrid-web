/**
 * RED for the second half of task 0845cf1c.
 *
 * OAuth access and refresh tokens are hashed at rest, but the authorization
 * code was written to the database verbatim and matched verbatim. Anyone able
 * to read the table got directly redeemable codes for their ten-minute
 * lifetime — the same leak the token hashing exists to prevent, on the
 * credential that exchanges into both tokens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const codeCreate = vi.hoisted(() => vi.fn())
const codeFindFirst = vi.hoisted(() => vi.fn())
const codeUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthAuthorizationCode: {
      create: codeCreate,
      findFirst: codeFindFirst,
      update: codeUpdate,
    },
  },
}))

const { generateAuthorizationCode, exchangeAuthorizationCode, hashToken, oauthTokenLookup } =
  await import('@/lib/oauth/oauth-token-manager')

beforeEach(() => {
  vi.clearAllMocks()
  codeCreate.mockResolvedValue({})
  codeFindFirst.mockResolvedValue(null)
})

describe('authorization code storage', () => {
  it('stores the hash, and returns the plaintext to the client', async () => {
    const code = await generateAuthorizationCode(
      'client-1',
      'user-1',
      'https://example.test/cb',
      ['tasks:read'],
    )

    expect(code).toMatch(/^astrid_code_/)

    const stored = codeCreate.mock.calls[0][0].data.code
    expect(stored).toBe(hashToken(code))
    expect(stored).not.toBe(code)
  })

  it('redeems by the same prefix-guarded dual read as the tokens', async () => {
    await exchangeAuthorizationCode(
      'astrid_code_abc',
      'client-1',
      'https://example.test/cb',
    )

    const where = codeFindFirst.mock.calls[0][0].where
    expect(where.code).toEqual({ in: oauthTokenLookup('astrid_code_abc') })
  })
})
