/**
 * @vitest-environment node
 *
 * AWTD-1451 (platform assessment W1): with no `listId`, the visibility clause
 * OR-ed `privacy: 'PUBLIC'` in, so the "my tasks" read (and its count) scanned
 * every public list in the deployment. Public tasks are not "mine"; they stay
 * reachable by `?listId=`, favorites and /api/lists/public.
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
  mockPrisma.task.count.mockResolvedValue(0 as never)
})

function get(query: string) {
  return GET(new NextRequest(`https://${BRAND.domain}/api/v1/tasks${query}`) as never, undefined as never)
}

const where = () => mockPrisma.task.findMany.mock.calls.at(-1)?.[0]?.where

describe('GET /api/v1/tasks without listId — AWTD-1451', () => {
  it('does not pull in tasks from public lists the caller has no tie to', async () => {
    await get('')
    expect(JSON.stringify(where())).not.toContain('PUBLIC')
  })

  it("still returns the caller's own, assigned and member/owned-list tasks", async () => {
    await get('')
    const json = JSON.stringify(where())
    expect(json).toContain('creatorId')
    expect(json).toContain('assigneeId')
    expect(json).toContain('listMembers')
    expect(json).toContain('ownerId')
  })

  it('keeps public lists readable by an explicit listId', async () => {
    await get('?listId=list-1')
    expect(JSON.stringify(where())).toContain('PUBLIC')
  })
})
