/**
 * @vitest-environment node
 *
 * AWTD-1020 — `GET /api/v1/tasks?assigneeEmail=…` ignored the filter and
 * returned whatever task came first. scripts/lib/agent-author.ts looks an agent
 * up that way, read the stranger's assignee off the answer, and sent it as
 * `aiAgentId`: a 400 when the stranger was Jon, a comment signed as the wrong
 * harness when it was another agent.
 *
 * The filter now narrows the query, case-insensitively (the address is typed
 * by people and scripts alike), and is additive: absent, nothing changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { GET } from '@/app/api/v1/tasks/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { BRAND } from '@/lib/brand/config'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
  getDeprecationWarning: vi.fn(() => null),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: 'user-1', source: 'oauth', scopes: ['tasks:read'],
  } as never)
  vi.mocked(requireScopes).mockImplementation(() => {})
  mockPrisma.task.findMany.mockResolvedValue([] as never)
  mockPrisma.task.count?.mockResolvedValue?.(0 as never)
})

function get(query: string) {
  return GET(new NextRequest(`https://${BRAND.domain}/api/v1/tasks${query}`) as never, undefined as never)
}

function whereFromLastCall() {
  return mockPrisma.task.findMany.mock.calls.at(-1)?.[0]?.where
}

describe('GET /api/v1/tasks — assigneeEmail (AWTD-1020)', () => {
  it('AWTD-1020: filters on the assignee\'s email, case-insensitively', async () => {
    const typed = `Claude@${BRAND.agentEmailDomain.toUpperCase()}`
    await get(`?assigneeEmail=${encodeURIComponent(typed)}&limit=1`)

    expect(whereFromLastCall()?.assignee).toEqual({
      email: { equals: typed, mode: 'insensitive' },
    })
  })

  it('AWTD-1020: answers an empty list when nobody matches, not an arbitrary task', async () => {
    const res = await get(`?assigneeEmail=${encodeURIComponent(`nobody@${BRAND.agentEmailDomain}`)}`)
    const body = await res.json()

    expect(whereFromLastCall()?.assignee).toBeDefined()
    expect(body.tasks).toEqual([])
  })

  it('leaves the query untouched when assigneeEmail is omitted', async () => {
    await get('?limit=10')

    expect(whereFromLastCall()).not.toHaveProperty('assignee')
  })
})
