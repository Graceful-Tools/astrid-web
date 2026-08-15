/**
 * RED for task 54cb7083 — the mobile MCP token route could answer 200 with
 * `{ token: null }`.
 *
 * The reuse path returned `resolveMCPPlaintext(existingToken)`, which is
 * `string | null`. It recovers plaintext from `tokenEncrypted`, falling back to
 * the `token` column for legacy pre-backfill rows. A row written during the
 * hash-only phase has neither — no `tokenEncrypted`, and a `token` column that
 * is already a hash — so it resolves to null, and the route handed that null
 * to the client.
 *
 * The user then gets a 200 with nothing usable, every MCP call fails with no
 * indication why, and because the row is still active and unexpired the route
 * keeps returning the same dead row for up to 90 days. Minting would have
 * recovered them instantly.
 *
 * REACHABILITY, checked before fixing (the task asked for this): production has
 * 13 MCPToken rows and ZERO with `tokenEncrypted` null, so no user is in this
 * state today. The code is still wrong — a restore from an old dump or a
 * partial backfill puts someone there — and the fix is one condition, so it is
 * worth closing rather than leaving as a trap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirst = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: { mCPToken: { findFirst, create, updateMany: vi.fn() } },
}))

const resolveMCPPlaintext = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mcp-token', () => ({
  resolveMCPPlaintext,
  mcpTokenStorageFields: () => ({ token: 'hashed', tokenEncrypted: 'enc' }),
}))

// generateMCPToken lives in mcp-token-utils, not mcp-token — mocking the wrong
// module let the real generator through and the assertion compared against a
// random token.
vi.mock('@/lib/mcp-token-utils', () => ({ generateMCPToken: () => 'astrid_freshly_minted' }))

import { mintOrReturnMobileToken } from '@/lib/mobile-mcp-token'

const liveRow = {
  id: 'tok-1',
  userId: 'user-1',
  token: 'already-a-hash',
  tokenEncrypted: null,
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ id: 'tok-new', userId: 'user-1' })
})

describe('mintOrReturnMobileToken (task 54cb7083)', () => {
  it('returns the existing token when its plaintext can be recovered', async () => {
    findFirst.mockResolvedValue({ ...liveRow, tokenEncrypted: 'enc' })
    resolveMCPPlaintext.mockReturnValue('astrid_recovered')

    const result = await mintOrReturnMobileToken('user-1')

    expect(result.token).toBe('astrid_recovered')
    // The whole point of reuse: do not mint when a usable one exists.
    expect(create).not.toHaveBeenCalled()
  })

  it('MINTS instead of returning null when the row cannot be resolved', async () => {
    findFirst.mockResolvedValue(liveRow)
    resolveMCPPlaintext.mockReturnValue(null)

    const result = await mintOrReturnMobileToken('user-1')

    expect(result.token).toBe('astrid_freshly_minted')
    expect(create).toHaveBeenCalled()
  })

  it('never returns a null token to the caller', async () => {
    findFirst.mockResolvedValue(liveRow)
    resolveMCPPlaintext.mockReturnValue(null)

    // The contract the client depends on: a 200 means a usable token. iOS has
    // no way to tell a null token from a working one until every later call
    // fails.
    const result = await mintOrReturnMobileToken('user-1')
    expect(result.token).not.toBeNull()
    expect(typeof result.token).toBe('string')
  })

  it('mints when there is no existing row at all', async () => {
    findFirst.mockResolvedValue(null)

    const result = await mintOrReturnMobileToken('user-1')

    expect(result.token).toBe('astrid_freshly_minted')
    expect(resolveMCPPlaintext).not.toHaveBeenCalled()
  })

  it('treats an empty-string plaintext as unusable too', async () => {
    // '' is falsy but type-checks as string, so a `!== null` test would let it
    // through and hand the client an empty token.
    findFirst.mockResolvedValue(liveRow)
    resolveMCPPlaintext.mockReturnValue('')

    expect((await mintOrReturnMobileToken('user-1')).token).toBe('astrid_freshly_minted')
  })
})
