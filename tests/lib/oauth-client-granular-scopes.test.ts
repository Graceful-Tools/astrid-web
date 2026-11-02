/**
 * Granular scope editing persists exactly the set its owner ticked (AWTD-1513).
 *
 * The one subtlety is the scope group. A client that follows a group is topped
 * back up to that group on every token request (`reconcileClientScopes`), so a
 * scope the owner unticks from that group would silently return the next time
 * the connection authenticates. An explicit narrowing therefore has to stop
 * the client following the group — otherwise the editor would save a change
 * the server then undoes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirst = vi.fn()
const update = vi.fn()

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

vi.mock('@/lib/oauth/scope-reconcile', () => ({ reconcileClientScopes: vi.fn() }))

import { updateOAuthClient } from '@/lib/oauth/oauth-client-manager'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'

function written(): Record<string, unknown> | undefined {
  return update.mock.calls[0]?.[0]?.data
}

beforeEach(() => {
  findFirst.mockReset()
  update.mockReset()
  update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'row-1', ...data }))
})

describe('updateOAuthClient — granular scopes (AWTD-1513)', () => {
  it('AWTD-1513: persists exactly the granular set on an unadopted client', async () => {
    findFirst.mockResolvedValue({ id: 'row-1', scopes: ['tasks:read'], scopeGroup: null })

    await updateOAuthClient('c', 'user-1', { scopes: ['tasks:read', 'lists:configure'] })

    expect(written()).toEqual({ scopes: ['tasks:read', 'lists:configure'] })
  })

  it('AWTD-1513: keeps the group when the new set still covers it', async () => {
    findFirst.mockResolvedValue({ id: 'row-1', scopes: [], scopeGroup: 'ai_agent' })
    const scopes = [...SCOPE_GROUPS.ai_agent, 'tasks:delete']

    await updateOAuthClient('c', 'user-1', { scopes })

    expect(written()).toEqual({ scopes })
  })

  it('AWTD-1513: narrowing below the followed group stops following it, or reconcile would undo the edit', async () => {
    findFirst.mockResolvedValue({ id: 'row-1', scopes: [...SCOPE_GROUPS.ai_agent], scopeGroup: 'ai_agent' })
    const scopes = SCOPE_GROUPS.ai_agent.filter(scope => scope !== 'lists:configure')

    await updateOAuthClient('c', 'user-1', { scopes })

    expect(written()).toEqual({ scopes, scopeGroup: null })
  })

  it('AWTD-1513: an explicit scopeGroup null clears the group', async () => {
    findFirst.mockResolvedValue({ id: 'row-1', scopes: ['tasks:read'], scopeGroup: 'readonly' })

    await updateOAuthClient('c', 'user-1', { scopeGroup: null })

    expect(written()).toEqual({ scopeGroup: null })
  })
})
