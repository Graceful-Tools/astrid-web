/**
 * RED for AWTD-1324.
 *
 * The My Tasks settings offered "Recently completed" (sortBy completedAt),
 * "This calendar week" and "This calendar month" — the shared list options —
 * but PATCH /api/v1/users/me/my-tasks-preferences rejects all three with a
 * 400, which the hook only logged. The choice applied, then vanished on
 * reload. iOS offers only what the API accepts; web now does the same.
 *
 * Also: with nothing saved, GET answered sortBy "priority" while the web hook
 * and iOS both default to "auto", so the active-filter indicator lit up for
 * users who had set nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ myTasksPreferences: null })),
      update: vi.fn(async ({ data }: { data: { myTasksPreferences: string } }) => data),
    },
  },
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(async () => ({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null })),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const { GET, PATCH } = await import('@/app/api/v1/users/me/my-tasks-preferences/route')
const options = await import('@/components/list-settings/filter-options')

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://t/api/v1/users/me/my-tasks-preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({}) } as never,
  )

beforeEach(() => vi.clearAllMocks())

describe('My Tasks offers only what the API stores (AWTD-1324)', () => {
  it('offers some of each, so it cannot pass by offering nothing', () => {
    expect(options.MY_TASKS_SORT_BY_OPTIONS.length).toBeGreaterThan(3)
    expect(options.MY_TASKS_DUE_DATE_FILTER_OPTIONS.length).toBeGreaterThan(3)
  })

  it.each(['sortBy', 'filterDueDate', 'filterCompletion'] as const)('every offered %s is accepted', async field => {
    const offered = {
      sortBy: options.MY_TASKS_SORT_BY_OPTIONS,
      filterDueDate: options.MY_TASKS_DUE_DATE_FILTER_OPTIONS,
      filterCompletion: options.COMPLETION_FILTER_OPTIONS,
    }[field]
    const rejected: string[] = []
    for (const { value } of offered) {
      if ((await patch({ [field]: value })).status !== 200) rejected.push(value)
    }
    expect(rejected).toEqual([])
  })

  it('with nothing saved, GET answers the same sort the clients default to', async () => {
    const res = await GET(new NextRequest('http://t/api/v1/users/me/my-tasks-preferences'), { params: Promise.resolve({}) } as never)
    expect((await res.json()).sortBy).toBe('auto')
  })
})
