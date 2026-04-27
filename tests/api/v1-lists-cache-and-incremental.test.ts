import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { GET } from '@/app/api/v1/lists/route'
import { authenticateAPI, requireScopes, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { RedisCache } from '@/lib/redis'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    keys: {
      userListsV1: (userId: string) => `lists:user:${userId}:v1`,
    },
    getOrSet: vi.fn(async (_key: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate: { userLists: vi.fn() },
  },
}))

vi.mock('@/lib/favorites', () => ({
  hydrateListFavorites: vi.fn(async () => {}),
}))

vi.mock('@/lib/task-count-utils', () => ({
  getTaskCountInclude: () => ({ _count: { select: { tasks: true } } }),
  getMultipleListTaskCounts: vi.fn(async () => ({})),
}))

const mockAuthenticateAPI = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)
const mockGetDeprecationWarning = vi.mocked(getDeprecationWarning)
const mockGetOrSet = vi.mocked(RedisCache.getOrSet)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthenticateAPI.mockResolvedValue({
    userId: 'user-1',
    source: 'oauth',
    scopes: ['lists:read'],
  } as any)
  mockRequireScopes.mockImplementation(() => {})
  mockGetDeprecationWarning.mockReturnValue(undefined)
  mockPrisma.taskList.findMany.mockResolvedValue([])
})

describe('GET /api/v1/lists — cache + incremental sync', () => {
  it('uses the v1 cache key on a full sync (no updatedSince)', async () => {
    const req = new Request('https://x.example/api/v1/lists') as any
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockGetOrSet).toHaveBeenCalledTimes(1)
    expect(mockGetOrSet).toHaveBeenCalledWith(
      'lists:user:user-1:v1',
      expect.any(Function),
      300
    )
  })

  it('skips the cache when updatedSince is provided (incremental sync)', async () => {
    const req = new Request('https://x.example/api/v1/lists?updatedSince=2026-04-26T00:00:00Z') as any
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockGetOrSet).not.toHaveBeenCalled()
    expect(mockPrisma.taskList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updatedAt: { gt: new Date('2026-04-26T00:00:00Z') },
        }),
      })
    )
  })

  it('returns sync metadata so clients can poll incrementally', async () => {
    const req = new Request('https://x.example/api/v1/lists') as any
    const res = await GET(req)
    const body = await res.json()
    expect(body.meta.isIncremental).toBe(false)
    expect(typeof body.meta.timestamp).toBe('string')
    expect(new Date(body.meta.timestamp).toString()).not.toBe('Invalid Date')

    const incrReq = new Request('https://x.example/api/v1/lists?updatedSince=2026-04-26T00:00:00Z') as any
    const incrRes = await GET(incrReq)
    const incrBody = await incrRes.json()
    expect(incrBody.meta.isIncremental).toBe(true)
  })
})
