/**
 * An agent connection's scopes come from its scope group, and catch up on use
 * (task 9ebfaba7).
 *
 * An OAuth client's scopes were frozen at creation. Several provisioning paths
 * never consulted SCOPE_GROUPS at all — `lib/astrid-api-client.ts` wrote the
 * same six-scope list three times — so adding a scope to a group reached
 * almost nothing, and bringing an existing connection up to date meant a
 * hand-written UPDATE against the production OAuthClient row.
 *
 * That is what surfaced it: `chat:read`/`chat:write` gate the v1 chat routes
 * but no client-credentials token could carry them, so every one 403'd.
 *
 * THIS FUNCTION WIDENS PRIVILEGES, so the tests that matter most are the ones
 * pinning what it must REFUSE to do. Four bounds, each with its own reason:
 *
 *   - an unmarked client is never touched (nothing existing gains scopes by
 *     surprise),
 *   - the write is a UNION, never a replace — the bug being fixed stripped any
 *     scope a client legitimately held beyond the hardcoded list,
 *   - the wildcard `'*'` is never grantable this way, because
 *     `validateRegisterableScopes` strips it on purpose and this must not
 *     become a back door to it,
 *   - widening is bounded by the client's NAMED group, never "everything in
 *     the enum".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.fn()
const update = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthClient: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}))

import { reconcileClientScopes } from '@/lib/oauth/scope-reconcile'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'

/** What `update` was asked to write, or undefined if it was never called. */
function writtenScopes(): string[] | undefined {
  return update.mock.calls[0]?.[0]?.data?.scopes
}

beforeEach(() => {
  findUnique.mockReset()
  update.mockReset()
  update.mockResolvedValue({})
})

describe('reconcileClientScopes (task 9ebfaba7)', () => {
  it('tops a marked client up to its group', async () => {
    findUnique.mockResolvedValue({
      id: 'c1',
      scopes: ['tasks:read', 'tasks:write'],
      scopeGroup: 'ai_agent',
    })

    const result = await reconcileClientScopes('c1')

    expect(result.changed).toBe(true)
    // The scopes that made the chat routes 403 are exactly what should arrive.
    expect(result.added).toEqual(expect.arrayContaining(['chat:read', 'chat:write', 'sse:connect']))
    expect(writtenScopes()).toEqual(expect.arrayContaining([...SCOPE_GROUPS.ai_agent]))
  })

  it('UNIONS rather than replaces, keeping a scope the group does not list', async () => {
    // The bug being fixed: `data: { scopes: REQUIRED_SCOPES }` discarded
    // anything the client legitimately held beyond that list.
    findUnique.mockResolvedValue({
      id: 'c1',
      scopes: ['tasks:read', 'attachments:write'],
      scopeGroup: 'ai_agent',
    })

    await reconcileClientScopes('c1')

    expect(writtenScopes()).toContain('attachments:write')
  })

  it('does nothing at all to a client with no scope group', async () => {
    // Every client that exists today is unmarked. None of them may gain a
    // scope as a side effect of this landing.
    findUnique.mockResolvedValue({ id: 'c1', scopes: ['tasks:read'], scopeGroup: null })

    const result = await reconcileClientScopes('c1')

    expect(result.changed).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('writes nothing when the client is already current', async () => {
    findUnique.mockResolvedValue({
      id: 'c1',
      scopes: [...SCOPE_GROUPS.ai_agent],
      scopeGroup: 'ai_agent',
    })

    const result = await reconcileClientScopes('c1')

    expect(result.changed).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('NEVER grants the wildcard, even if a group somehow names it', async () => {
    findUnique.mockResolvedValue({
      id: 'c1',
      scopes: ['tasks:read', '*'],
      scopeGroup: 'ai_agent',
    })

    await reconcileClientScopes('c1')

    // Present on the row already, but this function must not be the thing that
    // writes it — '*' is for session and legacy_mcp auth only.
    expect(writtenScopes()).not.toContain('*')
  })

  it('is bounded by the named group, not by the whole enum', async () => {
    // `tasks_only` is three scopes. A client marked with it must not collect
    // `user:read` or anything else merely because the enum contains it.
    findUnique.mockResolvedValue({ id: 'c1', scopes: [], scopeGroup: 'tasks_only' })

    await reconcileClientScopes('c1')

    expect(writtenScopes()!.sort()).toEqual([...SCOPE_GROUPS.tasks_only].sort())
    expect(writtenScopes()).not.toContain('user:read')
  })

  it('ignores a group name that is not a real group', async () => {
    // A row carrying a stale or hand-edited value must not throw, and must not
    // be treated as "grant everything".
    findUnique.mockResolvedValue({ id: 'c1', scopes: ['tasks:read'], scopeGroup: 'not_a_group' })

    const result = await reconcileClientScopes('c1')

    expect(result.changed).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not fall over when the client is gone', async () => {
    findUnique.mockResolvedValue(null)

    const result = await reconcileClientScopes('missing')

    expect(result.changed).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})
