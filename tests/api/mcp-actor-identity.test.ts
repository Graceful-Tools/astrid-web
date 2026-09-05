/**
 * Regression for task 13f43055.
 *
 * Every MCP operation handler called `validateMCPToken(args.accessToken)` and
 * then authorized against `mcpToken.userId`. But `accessToken` is optional —
 * `app/api/mcp/operations/route.ts` also accepts a session cookie and an OAuth
 * bearer, and in those cases nothing is in `args`. Prisma drops an `undefined`
 * filter, so `findFirst({ where: { token: undefined, isActive: true } })`
 * returned THE FIRST ACTIVE MCP TOKEN IN THE TABLE — belonging to any user —
 * and the handler then ran scoped to that stranger.
 *
 * A presented MCP token is a bearer credential, so acting as its owner is
 * correct BY DESIGN. The bug was only the absent-token path, which must fall
 * back to the identity `authenticateAPI` already resolved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockTokenFindFirst = vi.hoisted(() => vi.fn())
const mockUserFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mCPToken: { findFirst: mockTokenFindFirst },
    user: { findUnique: mockUserFindUnique },
    taskList: { findFirst: vi.fn() },
  },
}))

const { validateMCPToken, resolveMCPActor } = await import(
  '@/app/api/mcp/operations/handlers/shared'
)

const STRANGERS_TOKEN = {
  id: 'tok_stranger',
  userId: 'user-stranger',
  listId: null,
  isActive: true,
  user: { id: 'user-stranger', name: 'Stranger', email: 'stranger@example.com' },
  list: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // The vulnerable shape: the table has an active token and the query matched
  // it because the `token` filter was undefined.
  mockTokenFindFirst.mockResolvedValue(STRANGERS_TOKEN)
  mockUserFindUnique.mockResolvedValue({
    id: 'user-caller',
    name: 'Caller',
    email: 'caller@example.com',
  })
})

describe('validateMCPToken', () => {
  it('refuses a missing token instead of matching an arbitrary row', async () => {
    await expect(validateMCPToken(undefined as unknown as string)).rejects.toThrow(
      /MCP_TOKEN_INVALID/,
    )
    expect(mockTokenFindFirst).not.toHaveBeenCalled()
  })

  it('refuses a blank token', async () => {
    await expect(validateMCPToken('   ')).rejects.toThrow(/MCP_TOKEN_INVALID/)
    expect(mockTokenFindFirst).not.toHaveBeenCalled()
  })
})

describe('resolveMCPActor', () => {
  it('uses the authenticated user when no MCP token is presented', async () => {
    const actor = await resolveMCPActor(undefined, 'user-caller')

    expect(actor.userId).toBe('user-caller')
    expect(actor.user.email).toBe('caller@example.com')
    expect(actor.token).toBeNull()
    // The whole point: no token lookup happened, so no stranger's row could win.
    expect(mockTokenFindFirst).not.toHaveBeenCalled()
  })

  it('refuses when there is neither a token nor an authenticated user', async () => {
    await expect(resolveMCPActor(undefined, undefined)).rejects.toThrow(/MCP_TOKEN_INVALID/)
    expect(mockTokenFindFirst).not.toHaveBeenCalled()
    expect(mockUserFindUnique).not.toHaveBeenCalled()
  })

  it('still acts as the token owner when a token IS presented', async () => {
    const actor = await resolveMCPActor('astrid_mcp_real', 'user-caller')

    expect(actor.userId).toBe('user-stranger')
    expect(actor.token).not.toBeNull()
  })
})
