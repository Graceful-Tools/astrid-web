import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('user-stats')


export interface UserStats {
  completedTasks: number
  inspiredTasks: number
  supportedTasks: number
}

/**
 * Calculate user statistics from database
 *
 * - Completed: Tasks assigned to user and marked as completed
 * - Inspired: Tasks created by user that were completed by others OR copied by others
 * - Supported: Comments on tasks created by other users
 */
export async function calculateUserStats(userId: string): Promise<UserStats> {
  // Completed: Tasks where user is assignee AND completed
  const completedTasks = await prisma.task.count({
    where: {
      assigneeId: userId,
      completed: true,
    },
  })

  // Inspired: Tasks created by user, completed by others OR copied
  const inspiredTasks = await prisma.task.count({
    where: {
      creatorId: userId,
      OR: [
        // Completed by someone else
        {
          completed: true,
          assigneeId: { not: userId },
        },
        // Copied by someone else (has originalTaskId)
        {
          originalTaskId: { not: null },
        },
      ],
    },
  })

  // Supported: Comments on tasks created by others
  const supportedTasks = await prisma.comment.count({
    where: {
      authorId: userId,
      task: {
        creatorId: { not: userId },
      },
    },
  })

  return {
    completedTasks,
    inspiredTasks,
    supportedTasks,
  }
}

/**
 * Update user statistics in database
 * Returns the updated stats
 */
export async function updateUserStats(userId: string): Promise<UserStats> {
  const stats = await calculateUserStats(userId)

  await prisma.user.update({
    where: { id: userId },
    data: {
      statsCompletedTasks: stats.completedTasks,
      statsInspiredTasks: stats.inspiredTasks,
      statsSupportedTasks: stats.supportedTasks,
      statsLastCalculated: new Date(),
    },
  })

  return stats
}

/**
 * Get user stats (from cache if fresh, otherwise recalculate)
 * Stats are considered fresh if calculated within the last 24 hours
 * @param userId - The user ID to get stats for
 * @param forceRefresh - If true, always recalculate stats immediately (bypasses cache)
 */
export async function getUserStats(userId: string, forceRefresh: boolean = false): Promise<UserStats> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      statsCompletedTasks: true,
      statsInspiredTasks: true,
      statsSupportedTasks: true,
      statsLastCalculated: true,
    },
  })

  if (!user) {
    throw new Error("User not found")
  }

  // If forceRefresh is true, always recalculate immediately
  if (forceRefresh) {
    return await updateUserStats(userId)
  }

  // If stats were never calculated or are older than 24 hours, recalculate
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const needsUpdate = !user.statsLastCalculated || user.statsLastCalculated < oneDayAgo

  if (needsUpdate) {
    // Recalculate and update in background (don't wait)
    updateUserStats(userId).catch((err) => {
      log.error({ err: err }, `Failed to update stats for user ${userId}:`)
    })
  }

  // Return cached stats (or zeros if never calculated)
  return {
    completedTasks: user.statsCompletedTasks ?? 0,
    inspiredTasks: user.statsInspiredTasks ?? 0,
    supportedTasks: user.statsSupportedTasks ?? 0,
  }
}

/**
 * Increment a specific stat counter (optimistic update)
 * Useful for real-time updates when actions happen
 */
export async function incrementUserStat(
  userId: string,
  stat: "completedTasks" | "inspiredTasks" | "supportedTasks",
  amount: number = 1
): Promise<void> {
  const fieldMap = {
    completedTasks: "statsCompletedTasks",
    inspiredTasks: "statsInspiredTasks",
    supportedTasks: "statsSupportedTasks",
  }

  const field = fieldMap[stat]

  await prisma.user.update({
    where: { id: userId },
    data: {
      [field]: { increment: amount },
    },
  })
}

/**
 * Decrement a specific stat counter (optimistic update)
 */
export async function decrementUserStat(
  userId: string,
  stat: "completedTasks" | "inspiredTasks" | "supportedTasks",
  amount: number = 1
): Promise<void> {
  const fieldMap = {
    completedTasks: "statsCompletedTasks",
    inspiredTasks: "statsInspiredTasks",
    supportedTasks: "statsSupportedTasks",
  }

  const field = fieldMap[stat]

  await prisma.user.update({
    where: { id: userId },
    data: {
      [field]: { decrement: amount },
    },
  })
}

/**
 * Invalidate user stats cache for one or more users
 * This marks stats as stale so they'll be recalculated on next access
 * Use this when events occur that affect user stats (task completion, comments, etc.)
 */
export async function invalidateUserStats(userIds: string | string[]): Promise<void> {
  const ids = Array.isArray(userIds) ? userIds : [userIds]

  // Mark stats as very old so they'll be recalculated on next access
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: {
      statsLastCalculated: new Date(0), // Unix epoch (1970-01-01)
    },
  })
}
