/**
 * GET /api/v1/users/search?includeAIAgents=true is where the list-settings
 * picker learns which agents exist, and it reads existing User rows. muse@ had
 * none in production, so the picker never offered it (AWTD-992). The route now
 * creates the missing rows before it queries — and the WIRING is what this
 * test pins: drop the call and the picker is back to depending on a seed
 * script somebody has to remember.
 *
 * Mocks mirror tests/api/user-search-scope-leak.test.ts. `@/lib/ai/ensure-agent-user`
 * is mocked PARTIALLY so nothing else that imports it loses an export.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    taskList: { findMany: vi.fn() },
    task: { findFirst: vi.fn(), findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
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
    getDeprecationWarning: vi.fn(() => null), UnauthorizedError, ForbiddenError,
  }
})

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))
vi.mock('@/lib/ai/assignable-agents', () => ({
  getAssignableAgentEmails: () => [],
  getKeyedAgentEmails: () => [],
  getOfferableAgentEmails: vi.fn(async () => ['muse@astrid.cc', 'claude@astrid.cc']),
}))
vi.mock('@/lib/ai-agent-utils', () => ({ isCodingAgent: () => false }))
vi.mock('@/lib/api-key-cache', () => ({ hasValidApiKey: vi.fn(async () => false) }))

const ensureOfferedAgentUsers = vi.fn()
vi.mock('@/lib/ai/ensure-agent-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/ensure-agent-user')>()),
  ensureOfferedAgentUsers: (...args: unknown[]) => ensureOfferedAgentUsers(...args),
}))

import { GET as v1Search } from '@/app/api/v1/users/search/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  ensureOfferedAgentUsers.mockResolvedValue(undefined)
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: USER, source: 'oauth', scopes: ['user:read'], isAIAgent: false,
    user: { id: USER, email: 'u@example.com', name: 'U', isAIAgent: false },
  } as never)
  mockPrisma.taskList.findMany.mockResolvedValue([] as never)
  mockPrisma.user.findMany.mockResolvedValue([] as never)
  mockPrisma.task.findFirst.mockResolvedValue(null as never)
  mockPrisma.user.findUnique.mockResolvedValue(null as never)
})

describe('GET /api/v1/users/search?includeAIAgents=true creates missing agent rows (AWTD-992)', () => {
  it('ensures every offerable agent has a User row BEFORE querying for them', async () => {
    const res = await v1Search(new NextRequest('http://localhost/api/v1/users/search?includeAIAgents=true'))

    expect(res.status).toBe(200)
    expect(ensureOfferedAgentUsers).toHaveBeenCalledWith(['muse@astrid.cc', 'claude@astrid.cc'])
    // Creating after the query would still leave the picker empty on this load.
    const queries = mockPrisma.user.findMany.mock.invocationCallOrder
    expect(queries.length).toBeGreaterThan(0)
    expect(ensureOfferedAgentUsers.mock.invocationCallOrder[0]).toBeLessThan(Math.max(...queries))
  })

  it('leaves the rows alone on a plain search that does not ask for agents', async () => {
    await v1Search(new NextRequest('http://localhost/api/v1/users/search?q=jon'))

    expect(ensureOfferedAgentUsers).not.toHaveBeenCalled()
  })
})
