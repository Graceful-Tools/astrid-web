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
}))

const mockAuthenticateAPI = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)

beforeEach(() => {
  vi.clearAllMocks()
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
