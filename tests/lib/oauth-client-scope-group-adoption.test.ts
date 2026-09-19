/**
 * A connection's owner can adopt it into a scope group from Settings, and its
 * scopes catch up on the spot (AWTD-962).
 *
 * `reconcileClientScopes` shipped and works, but bound 1 — "no group, no
 * change" — means it is a no-op until something records the group. In
 * production on 2026-09-19 that was EVERY row: all 23 `OAuthClient` records
 * carried `scopeGroup: null`, so no client-credentials token could ever gain
 * `chat:read`/`chat:write`, and the only route to one was the hand-written
 * UPDATE against production that Jon rejected on 2026-09-16.
 *
 * The three writers that DO stamp a group (`lib/astrid-api-client.ts`,
 * `/api/v1/custom-agents/register`, `scripts/setup-ios-oauth.ts`) each own one
 * known client. A connection created in Settings → API Access — which is what
 * the `/fixall` harness authenticates as — is reachable from none of them, and
 * no column marks it as an agent connection, so it can never "catch up on
 * use". Adoption has to be something its owner can DO.
 *
 * This widens privileges, so the tests that matter are the refusals. Adoption
 * writes only `scopeGroup` and then delegates to `reconcileClientScopes`; it
 * must never write `scopes` itself, because doing so would be a second copy of
 * bounds 2-4 that is free to disagree with the first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirst = vi.fn()
const update = vi.fn()
const reconcileClientScopes = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthClient: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      update: (...args: unknown[]) => update(...args),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock('@/lib/oauth/scope-reconcile', () => ({
  reconcileClientScopes: (...args: unknown[]) => reconcileClientScopes(...args),
}))

import { adoptClientScopeGroup } from '@/lib/oauth/oauth-client-manager'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'

/** The `data` object `update` was asked to write, or undefined. */
function written(): Record<string, unknown> | undefined {
  return update.mock.calls[0]?.[0]?.data
}

beforeEach(() => {
  findFirst.mockReset()
  update.mockReset()
  reconcileClientScopes.mockReset()

  findFirst.mockResolvedValue({ id: 'row-1', clientId: 'astrid_client_abc', userId: 'user-1' })
  update.mockResolvedValue({
    id: 'row-1',
    clientId: 'astrid_client_abc',
    name: 'github vscode',
    scopeGroup: 'ai_agent',
    scopes: [...SCOPE_GROUPS.ai_agent],
  })
  reconcileClientScopes.mockResolvedValue({ changed: true, added: ['chat:read', 'chat:write'] })
})

describe('adoptClientScopeGroup (AWTD-962)', () => {
  it('stamps the named group and tops the client up through the reconciler', async () => {
    const result = await adoptClientScopeGroup('astrid_client_abc', 'user-1', 'ai_agent')

    expect(written()).toEqual({ scopeGroup: 'ai_agent' })
    expect(reconcileClientScopes).toHaveBeenCalledWith('row-1')
    expect(result.added).toEqual(['chat:read', 'chat:write'])
  })

  it('never writes `scopes` itself — bounds 2-4 live in one place only', async () => {
    await adoptClientScopeGroup('astrid_client_abc', 'user-1', 'ai_agent')

    expect(written()).not.toHaveProperty('scopes')
  })

  it('reconciles AFTER the group is stamped, or the reconcile is a no-op', async () => {
    const order: string[] = []
    update.mockImplementation(async () => {
      order.push('stamp')
      return { id: 'row-1', clientId: 'astrid_client_abc', scopeGroup: 'ai_agent', scopes: [] }
    })
    reconcileClientScopes.mockImplementation(async () => {
      order.push('reconcile')
      return { changed: false, added: [] }
    })

    await adoptClientScopeGroup('astrid_client_abc', 'user-1', 'ai_agent')

    expect(order).toEqual(['stamp', 'reconcile'])
  })

  it('refuses an unrecognised group name rather than defaulting open (bound 4)', async () => {
    await expect(
      adoptClientScopeGroup('astrid_client_abc', 'user-1', 'not_a_group'),
    ).rejects.toThrow(/scope group/i)

    expect(update).not.toHaveBeenCalled()
    expect(reconcileClientScopes).not.toHaveBeenCalled()
  })

  it('refuses the wildcard as a group name', async () => {
    await expect(
      adoptClientScopeGroup('astrid_client_abc', 'user-1', '*'),
    ).rejects.toThrow(/scope group/i)

    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a client the caller does not own, and says nothing about whether it exists', async () => {
    findFirst.mockResolvedValue(null)

    await expect(
      adoptClientScopeGroup('someone-elses-client', 'user-1', 'ai_agent'),
    ).rejects.toThrow(/not found/i)

    expect(update).not.toHaveBeenCalled()
    expect(reconcileClientScopes).not.toHaveBeenCalled()
  })

  it('scopes the ownership lookup to the caller, not to the client id alone', async () => {
    await adoptClientScopeGroup('astrid_client_abc', 'user-1', 'ai_agent')

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'astrid_client_abc', userId: 'user-1' }),
      }),
    )
  })

  it('is idempotent: re-adopting an already-marked client is a quiet no-change', async () => {
    reconcileClientScopes.mockResolvedValue({ changed: false, added: [] })

    const result = await adoptClientScopeGroup('astrid_client_abc', 'user-1', 'ai_agent')

    expect(result.added).toEqual([])
    expect(result.changed).toBe(false)
  })
})
