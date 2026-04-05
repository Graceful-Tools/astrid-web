import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()
const mockFindUnique = vi.fn()
const mockUpsert = vi.fn()
const mockDeleteMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userListFavorite: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      upsert: (...args: any[]) => mockUpsert(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
  },
}))

// Mock redis
vi.mock('@/lib/redis', () => ({
  RedisCache: {
    invalidate: {
      userLists: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

import { toggleFavorite, hydrateListFavorites, hydrateSingleListFavorite } from '@/lib/favorites'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toggleFavorite', () => {
  it('creates a UserListFavorite when favoriting', async () => {
    mockFindFirst.mockResolvedValue({ favoriteOrder: 2 })
    mockUpsert.mockResolvedValue({})

    await toggleFavorite('user-1', 'list-1', true)

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { favoriteOrder: 'desc' },
      select: { favoriteOrder: true },
    })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId_listId: { userId: 'user-1', listId: 'list-1' } },
      create: { userId: 'user-1', listId: 'list-1', favoriteOrder: 3 },
      update: { favoriteOrder: 3 },
    })
  })

  it('uses order 1 when user has no existing favorites', async () => {
    mockFindFirst.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})

    await toggleFavorite('user-1', 'list-1', true)

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ favoriteOrder: 1 }),
      })
    )
  })

  it('deletes the UserListFavorite when unfavoriting', async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 })

    await toggleFavorite('user-1', 'list-1', false)

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', listId: 'list-1' },
    })
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('hydrateListFavorites', () => {
  it('sets isFavorite and favoriteOrder on each list', async () => {
    mockFindMany.mockResolvedValue([
      { listId: 'list-1', favoriteOrder: 1 },
      { listId: 'list-3', favoriteOrder: 2 },
    ])

    const lists = [
      { id: 'list-1', isFavorite: false, favoriteOrder: null },
      { id: 'list-2', isFavorite: false, favoriteOrder: null },
      { id: 'list-3', isFavorite: false, favoriteOrder: null },
    ]

    const result = await hydrateListFavorites(lists, 'user-1')

    expect(result[0].isFavorite).toBe(true)
    expect(result[0].favoriteOrder).toBe(1)
    expect(result[1].isFavorite).toBe(false)
    expect(result[1].favoriteOrder).toBeNull()
    expect(result[2].isFavorite).toBe(true)
    expect(result[2].favoriteOrder).toBe(2)
  })

  it('returns empty array for empty input', async () => {
    const result = await hydrateListFavorites([], 'user-1')
    expect(result).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

describe('hydrateSingleListFavorite', () => {
  it('sets isFavorite=true when favorite exists', async () => {
    mockFindUnique.mockResolvedValue({ favoriteOrder: 5 })

    const list = { id: 'list-1', isFavorite: false, favoriteOrder: null as number | null }
    const result = await hydrateSingleListFavorite(list, 'user-1')

    expect(result.isFavorite).toBe(true)
    expect(result.favoriteOrder).toBe(5)
  })

  it('sets isFavorite=false when no favorite exists', async () => {
    mockFindUnique.mockResolvedValue(null)

    const list = { id: 'list-1', isFavorite: true, favoriteOrder: 3 as number | null }
    const result = await hydrateSingleListFavorite(list, 'user-1')

    expect(result.isFavorite).toBe(false)
    expect(result.favoriteOrder).toBeNull()
  })
})
