/**
 * AWTD-1320: toggling a favourite evicted the user's whole cached list set
 * (legacy AND v1, via a pattern delete). Both list GETs hydrate isFavorite /
 * favoriteOrder AFTER the cache read, so the cached rows never carried them —
 * the eviction only bought a cold reload of every list with three relation
 * includes. The favourite must still be written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redis = vi.hoisted(() => ({
  RedisCache: { invalidate: { userLists: vi.fn(), userListsAllVersions: vi.fn() }, delPattern: vi.fn(), del: vi.fn() },
}))
vi.mock('@/lib/redis', () => redis)
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userListFavorite: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}))

const { toggleFavorite } = await import('@/lib/favorites')
const { prisma } = await import('@/lib/prisma')

beforeEach(() => vi.clearAllMocks())

describe('toggleFavorite cache (AWTD-1320)', () => {
  it.each([true, false])('favourite=%s writes the row and evicts nothing', async isFavorite => {
    await toggleFavorite('u1', 'l1', isFavorite)

    const fav = vi.mocked(prisma.userListFavorite)
    const wrote = isFavorite
      ? fav.upsert.mock.calls.length + fav.create.mock.calls.length
      : fav.deleteMany.mock.calls.length
    expect(wrote).toBe(1)
    expect(redis.RedisCache.invalidate.userLists).not.toHaveBeenCalled()
    expect(redis.RedisCache.invalidate.userListsAllVersions).not.toHaveBeenCalled()
    expect(redis.RedisCache.delPattern).not.toHaveBeenCalled()
  })
})
