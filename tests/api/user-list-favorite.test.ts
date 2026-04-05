import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests that per-user favorites are isolated between users.
 * User A favoriting a list should NOT affect User B's view.
 */

// Per-user state store — shared between mock and tests
const userFavorites = new Map<string, Map<string, number>>()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userListFavorite: {
      findFirst: vi.fn(async (args: any) => {
        const userFavs = userFavorites.get(args.where.userId)
        if (!userFavs || userFavs.size === 0) return null
        let maxOrder = 0
        for (const order of userFavs.values()) {
          if (order > maxOrder) maxOrder = order
        }
        return { favoriteOrder: maxOrder }
      }),
      findMany: vi.fn(async (args: any) => {
        const userFavs = userFavorites.get(args.where.userId)
        if (!userFavs) return []
        return Array.from(userFavs.entries()).map(([listId, favoriteOrder]) => ({
          listId,
          favoriteOrder,
        }))
      }),
      findUnique: vi.fn(async (args: any) => {
        const { userId, listId } = args.where.userId_listId
        const userFavs = userFavorites.get(userId)
        if (!userFavs || !userFavs.has(listId)) return null
        return { favoriteOrder: userFavs.get(listId) }
      }),
      upsert: vi.fn(async (args: any) => {
        const { userId, listId } = args.where.userId_listId
        if (!userFavorites.has(userId)) userFavorites.set(userId, new Map())
        userFavorites.get(userId)!.set(listId, args.create.favoriteOrder)
        return args.create
      }),
      deleteMany: vi.fn(async (args: any) => {
        const userFavs = userFavorites.get(args.where.userId)
        if (userFavs) userFavs.delete(args.where.listId)
        return { count: 1 }
      }),
    },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    invalidate: { userLists: vi.fn().mockResolvedValue(undefined) },
  },
}))

import { toggleFavorite, hydrateListFavorites } from '@/lib/favorites'

beforeEach(() => {
  userFavorites.clear()
})

describe('Per-user favorite isolation', () => {
  it('User A favoriting a list does not affect User B', async () => {
    await toggleFavorite('user-A', 'list-1', true)

    // User B should not see list-1 as favorited
    const listsForB = [{ id: 'list-1', isFavorite: false, favoriteOrder: null as number | null }]
    await hydrateListFavorites(listsForB, 'user-B')
    expect(listsForB[0].isFavorite).toBe(false)
    expect(listsForB[0].favoriteOrder).toBeNull()

    // User A should see list-1 as favorited
    const listsForA = [{ id: 'list-1', isFavorite: false, favoriteOrder: null as number | null }]
    await hydrateListFavorites(listsForA, 'user-A')
    expect(listsForA[0].isFavorite).toBe(true)
    expect(listsForA[0].favoriteOrder).toBe(1)
  })

  it('each user has independent favorite ordering', async () => {
    await toggleFavorite('user-A', 'list-1', true)
    await toggleFavorite('user-A', 'list-2', true)
    await toggleFavorite('user-B', 'list-2', true)

    const listsForA = [
      { id: 'list-1', isFavorite: false, favoriteOrder: null as number | null },
      { id: 'list-2', isFavorite: false, favoriteOrder: null as number | null },
    ]
    await hydrateListFavorites(listsForA, 'user-A')
    expect(listsForA[0].isFavorite).toBe(true)
    expect(listsForA[0].favoriteOrder).toBe(1)
    expect(listsForA[1].isFavorite).toBe(true)
    expect(listsForA[1].favoriteOrder).toBe(2)

    const listsForB = [
      { id: 'list-1', isFavorite: false, favoriteOrder: null as number | null },
      { id: 'list-2', isFavorite: false, favoriteOrder: null as number | null },
    ]
    await hydrateListFavorites(listsForB, 'user-B')
    expect(listsForB[0].isFavorite).toBe(false)
    expect(listsForB[1].isFavorite).toBe(true)
    expect(listsForB[1].favoriteOrder).toBe(1)
  })

  it('unfavoriting only affects the acting user', async () => {
    await toggleFavorite('user-A', 'list-1', true)
    await toggleFavorite('user-B', 'list-1', true)

    await toggleFavorite('user-A', 'list-1', false)

    const listsForA = [{ id: 'list-1', isFavorite: false, favoriteOrder: null as number | null }]
    await hydrateListFavorites(listsForA, 'user-A')
    expect(listsForA[0].isFavorite).toBe(false)

    const listsForB = [{ id: 'list-1', isFavorite: false, favoriteOrder: null as number | null }]
    await hydrateListFavorites(listsForB, 'user-B')
    expect(listsForB[0].isFavorite).toBe(true)
  })
})
