/**
 * @vitest-environment node
 *
 * The web client re-fetched every task on every page load — ~1.9 MB measured
 * against production — because the render path never used the IndexedDB cache
 * and never asked for a delta.
 *
 * The legacy /api/tasks route has supported `updatedSince` for a while; the v1
 * route ignored it, so a client that migrated to v1 would silently fall back to
 * a full fetch. Verified against production before this change: the responses
 * for `/api/v1/tasks?limit=1000` and the same URL plus `updatedSince` were
 * byte-identical at 1,912,006 bytes.
 *
 * `updatedSince` is additive, not a breaking change: it is optional, the where
 * clause is untouched when it is absent, and the response shape is the same
 * either way. These tests pin both halves of that — the filter works, AND
 * omitting it changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { GET } from '@/app/api/v1/tasks/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
  getDeprecationWarning: vi.fn(() => null),
}))

const mockAuthenticateAPI = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.task.count.mockResolvedValue(0 as never)
  mockAuthenticateAPI.mockResolvedValue({
    userId: 'user-1', source: 'oauth', scopes: ['tasks:read'],
  } as never)
  mockRequireScopes.mockImplementation(() => {})
  mockPrisma.task.findMany.mockResolvedValue([] as never)
  mockPrisma.task.count?.mockResolvedValue?.(0 as never)
})

function get(query: string) {
  return GET(new NextRequest(`https://astrid.cc/api/v1/tasks${query}`) as never, undefined as never)
}

/** The `where` Prisma was actually asked for. */
function whereFromLastCall() {
  return mockPrisma.task.findMany.mock.calls.at(-1)?.[0]?.where
}

describe('GET /api/v1/tasks — updatedSince (delta sync)', () => {
  it('filters by updatedAt when updatedSince is supplied', async () => {
    const since = '2026-07-26T12:00:00.000Z'

    await get(`?updatedSince=${encodeURIComponent(since)}`)

    expect(whereFromLastCall()?.updatedAt).toEqual({ gt: new Date(since) })
  })

  it('leaves the query untouched when updatedSince is omitted', async () => {
    // The additive guarantee: existing clients must see identical behaviour.
    await get('?limit=10')

    expect(whereFromLastCall()).not.toHaveProperty('updatedAt')
  })

  it('keeps the caller-visibility clause intact alongside the delta filter', async () => {
    // A delta must narrow by time, never widen who can see what.
    await get('?updatedSince=2026-07-26T12:00:00.000Z')

    const where = whereFromLastCall()
    expect(where?.OR, 'visibility OR clause must survive').toBeTruthy()
    expect(where?.updatedAt).toBeTruthy()
  })

  it('combines with listId rather than replacing it', async () => {
    await get('?listId=list-1&updatedSince=2026-07-26T12:00:00.000Z')

    const where = whereFromLastCall()
    expect(where?.lists).toBeTruthy()
    expect(where?.updatedAt).toBeTruthy()
  })

  it('ignores an unparseable updatedSince instead of returning nothing', async () => {
    // A bad cursor must not silently empty the client's task list.
    await get('?updatedSince=not-a-date')

    expect(whereFromLastCall()).not.toHaveProperty('updatedAt')
  })
})

/**
 * Delta sync must also report what disappeared. Tasks are hard-deleted, so a
 * client syncing incrementally previously kept showing tasks that were already
 * gone — on web, iOS and Mac alike. DeletionLog tombstones make the delta
 * complete, which is what lets a client trust it.
 */
describe('GET /api/v1/tasks — deletedIds', () => {
  it('reports ids deleted since the cursor', async () => {
    mockPrisma.deletionLog.findMany.mockResolvedValue([
      { entityId: 'gone-1' }, { entityId: 'gone-2' },
    ] as never)

    const res = await get('?updatedSince=2026-07-26T12:00:00.000Z')
    const body = await res.json()

    expect(body.deletedIds).toEqual(['gone-1', 'gone-2'])
  })

  it('scopes the query to this caller', async () => {
    // A deletion id reveals the entity existed; it must not leak.
    await get('?updatedSince=2026-07-26T12:00:00.000Z')

    const where = mockPrisma.deletionLog.findMany.mock.calls[0][0].where
    expect(where.audienceIds).toEqual({ has: 'user-1' })
    expect(where.entity).toBe('task')
  })

  it('omits deletedIds entirely on a full fetch', async () => {
    // Additive guarantee: a client that never sends updatedSince sees the exact
    // response it saw before this feature existed.
    const res = await get('?limit=10')
    const body = await res.json()

    expect(body).not.toHaveProperty('deletedIds')
    expect(mockPrisma.deletionLog.findMany).not.toHaveBeenCalled()
  })

  it('still returns tasks when the tombstone query fails', async () => {
    mockPrisma.deletionLog.findMany.mockRejectedValue(new Error('db down'))

    const res = await get('?updatedSince=2026-07-26T12:00:00.000Z')

    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('tasks')
  })
})
