/**
 * @vitest-environment node
 *
 * AWTD-1643: the "my tasks" read (GET /api/v1/tasks with no listId) used an
 * owner/member-only list clause, so a project member's sync left out tasks on
 * project lists they are not directly a member of — while opening the same
 * task (AWTD-1523) and `?listId=` (AWTD-1519) already let them in.
 *
 * The no-listId branch now uses the same list clause as the task write
 * boundary (`taskMembershipBranches`): owned, shared, or in a project the
 * caller owns or belongs to. PUBLIC stays out (AWTD-1451), and so does the
 * derived label branch, which spans other boards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { GET } from '@/app/api/v1/tasks/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { BRAND } from '@/lib/brand/config'
import { listVisibilityWhere } from '@/lib/list-permissions'
import { LIST_TYPE_LABEL } from '@/lib/list-flavors'

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

const findWhere = () => mockPrisma.task.findMany.mock.calls.at(-1)?.[0]?.where
const countWhere = () => mockPrisma.task.count.mock.calls.at(-1)?.[0]?.where

const listBranch = (where: { OR: Array<Record<string, unknown>> }) =>
  where.OR.find(branch => 'lists' in branch)

describe('GET /api/v1/tasks without listId — project lists (AWTD-1643)', () => {
  it("includes tasks on the caller's project lists, through the shared list clause", async () => {
    await get('')
    expect(listBranch(findWhere())).toEqual({
      lists: {
        some: listVisibilityWhere('user-1', { includePublic: false, includeDerivedLabels: false }),
      },
    })
  })

  it("scopes the project route to the caller, not to every project's lists", async () => {
    await get('')
    const json = JSON.stringify(listBranch(findWhere()))
    expect(json).toContain('"project"')
    // Every userId/ownerId the clause matches on is the caller's.
    const ids = [...json.matchAll(/"(?:userId|ownerId)":"([^"]+)"/g)].map(m => m[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids)).toEqual(new Set(['user-1']))
  })

  it('still leaves public lists and the derived label branch out (AWTD-1451)', async () => {
    await get('')
    const json = JSON.stringify(findWhere())
    expect(json).not.toContain('PUBLIC')
    expect(json).not.toContain(`"listType":"${LIST_TYPE_LABEL}"`)
    expect(json).not.toContain('remoteNodeId')
  })

  it('counts with the same clause it pages with, including under updatedSince', async () => {
    await get('?updatedSince=2026-11-01T00:00:00.000Z')
    expect(listBranch(countWhere())).toEqual(listBranch(findWhere()))
    expect(findWhere().updatedAt).toEqual({ gt: new Date('2026-11-01T00:00:00.000Z') })
  })
})
