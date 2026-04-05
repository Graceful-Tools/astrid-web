/**
 * Per-user list favorites — read/write helpers for UserListFavorite table.
 */

import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'

/**
 * Toggle a list as favorite for a specific user.
 * When favoriting, assigns the next available order.
 */
export async function toggleFavorite(
  userId: string,
  listId: string,
  isFavorite: boolean
): Promise<void> {
  if (isFavorite) {
    // Find current max order for this user
    const max = await prisma.userListFavorite.findFirst({
      where: { userId },
      orderBy: { favoriteOrder: 'desc' },
      select: { favoriteOrder: true },
    })
    const nextOrder = (max?.favoriteOrder ?? 0) + 1

    await prisma.userListFavorite.upsert({
      where: { userId_listId: { userId, listId } },
      create: { userId, listId, favoriteOrder: nextOrder },
      update: { favoriteOrder: nextOrder },
    })
  } else {
    await prisma.userListFavorite.deleteMany({
      where: { userId, listId },
    })
  }

  // Invalidate cached lists for this user
  try {
    await RedisCache.invalidate.userLists(userId)
  } catch {
    // Redis may not be available in dev
  }
}

/**
 * Hydrate isFavorite / favoriteOrder onto list objects for a specific user.
 * Mutates the list objects in place and returns them.
 */
export async function hydrateListFavorites<
  T extends { id: string; isFavorite?: boolean; favoriteOrder?: number | null }
>(lists: T[], userId: string): Promise<T[]> {
  if (lists.length === 0) return lists

  const favorites = await prisma.userListFavorite?.findMany({
    where: { userId },
    select: { listId: true, favoriteOrder: true },
  }) ?? []

  const favMap = new Map(favorites.map((f) => [f.listId, f.favoriteOrder]))

  for (const list of lists) {
    const order = favMap.get(list.id)
    if (order !== undefined) {
      list.isFavorite = true
      list.favoriteOrder = order
    } else {
      list.isFavorite = false
      list.favoriteOrder = null
    }
  }

  return lists
}

/**
 * Hydrate a single list's favorite state for a user.
 */
export async function hydrateSingleListFavorite<
  T extends { id: string; isFavorite?: boolean; favoriteOrder?: number | null }
>(list: T, userId: string): Promise<T> {
  const fav = await prisma.userListFavorite?.findUnique({
    where: { userId_listId: { userId, listId: list.id } },
    select: { favoriteOrder: true },
  }) ?? null

  list.isFavorite = !!fav
  list.favoriteOrder = fav?.favoriteOrder ?? null
  return list
}
