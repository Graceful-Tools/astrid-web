/**
 * PUT /api/v1/lists/[id] must persist `aiAgentsEnabled`.
 *
 * This field was silently DROPPED by v1's allow-list for months while two list
 * settings pickers wrote it — the "Astrid Agent" select saved, answered 200,
 * and sprang back on reload, which reads as a broken control rather than a
 * rejected write. Same failure shape as the status-fields gap (task dc143ab2):
 * an allow-listed PUT quietly loses a field a client depends on.
 *
 * Normalization is part of the contract: clients still send the legacy
 * `string[]` shape, and the one real reader (lib/resolve-default-agent.ts)
 * expects the object form.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    listActivity: { create: vi.fn() },
    activityLog: { create: vi.fn() },
    task: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    keys: { userListsV1: (id: string) => `lists:v1:${id}` },
    getOrSet: vi.fn(async (_k: string, producer: () => Promise<unknown>) => producer()),
    invalidate: { userLists: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

const reconcileAgentLifecycleBoard = vi.fn().mockResolvedValue({
  scanned: 0,
  transitioned: 0,
  unchanged: 0,
})
vi.mock('@/lib/agent-lifecycle-mutations', () => ({
  reconcileBoardLifecycleAfterMutation: (...args: unknown[]) => reconcileAgentLifecycleBoard(...args),
}))

import { PUT } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const listRow = {
  id: 'l1',
  ownerId: 'u1',
  name: 'Web To-do',
  privacy: 'PRIVATE',
  owner: { id: 'u1', name: 'Jon', email: 'j@e.com', image: null },
  listMembers: [],
  listInvites: [],
  defaultAssigneeId: null,
  agentLifecycleEnabled: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const ctx = { params: Promise.resolve({ id: 'l1' }) }

async function put(body: Record<string, unknown>) {
  await PUT(
    new NextRequest('http://localhost/api/v1/lists/l1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx as never
  )
  return (mockPrisma.taskList.update.mock.calls[0]?.[0] as never as {
    data: Record<string, unknown>
  })?.data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.taskList.findFirst.mockResolvedValue(listRow as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(listRow as never)
  mockPrisma.taskList.update.mockResolvedValue(listRow as never)
  ;(mockPrisma.$transaction as any).mockImplementation((operation: any) => operation(mockPrisma))
  mockPrisma.user.findMany.mockResolvedValue([] as never)
})

describe('PUT /api/v1/lists/[id] aiAgentsEnabled', () => {
  it('persists the object shape, normalized', async () => {
    // The per-list default agent — the one part of this field anything reads.
    const data = await put({ aiAgentsEnabled: { defaultAgentId: 'agent-1' } })

    expect(data?.aiAgentsEnabled).toEqual({ enabledTypes: [], defaultAgentId: 'agent-1' })
  })

  describe('PUT /api/v1/lists/[id] agentLifecycleEnabled (AWTD-760)', () => {
    it('persists an explicit boolean opt-in', async () => {
      const data = await put({ agentLifecycleEnabled: true })

      expect(data?.agentLifecycleEnabled).toBe(true)
      expect(reconcileAgentLifecycleBoard).toHaveBeenCalledWith('l1')
    })

    it('does not change opt-in when omitted', async () => {
      const data = await put({ name: 'Renamed' })

      expect(data && 'agentLifecycleEnabled' in data).toBe(false)
    })
  })

  it('normalizes the legacy string[] shape instead of storing it raw', async () => {
    // The array is what every client on the wire sends. It cannot carry a
    // default agent, so the stored one is kept (none here → null).
    const data = await put({ aiAgentsEnabled: ['claude', 'coding'] })

    expect(data?.aiAgentsEnabled).toEqual({ enabledTypes: ['claude', 'coding'], defaultAgentId: null })
  })

  it('normalizes garbage to the empty config rather than dropping the write', async () => {
    // A clearing write ({}) must actually clear — springing back to the old
    // default agent is the bug this test exists to prevent.
    const data = await put({ aiAgentsEnabled: 'not json at all' })

    expect(data?.aiAgentsEnabled).toEqual({ enabledTypes: [], defaultAgentId: null })
  })

  it('leaves the field untouched when the payload does not mention it', async () => {
    // Clients round-trip whole list objects; a rename must not reset the agent.
    const data = await put({ name: 'Renamed' })

    expect(data && 'aiAgentsEnabled' in data).toBe(false)
  })
})
