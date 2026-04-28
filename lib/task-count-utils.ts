/**
 * Utilities for accurate task counting across different list contexts
 * This ensures consistent counting logic for public lists, private lists, and MCP operations
 */

import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('task-count-utils')


export interface TaskCountOptions {
  /** Include completed tasks in the count */
  includeCompleted?: boolean
  /** Include private tasks in the count (for public lists, usually false) */
  includePrivate?: boolean
  /** User ID for permission checking */
  userId?: string
  /** Whether this is for public list browsing (applies stricter filtering) */
  isPublicContext?: boolean
}

/**
 * Get accurate task count for a specific list with proper filtering
 */
export async function getListTaskCount(
  listId: string,
  options: TaskCountOptions = {}
): Promise<number> {
  const {
    includeCompleted = true,
    includePrivate = true,
    userId,
    isPublicContext = false
  } = options

  try {
    const where: any = {
      lists: {
        some: {
          id: listId
        }
      }
    }

    // For public list contexts, be more restrictive
    if (isPublicContext) {
      // Only show non-private tasks for public lists
      where.isPrivate = false

      // For public lists, typically only show incomplete tasks unless explicitly requested
      if (!includeCompleted) {
        where.completed = false
      }
    } else {
      // For private contexts, apply user-specific filtering
      if (!includeCompleted) {
        where.completed = false
      }

      if (!includePrivate) {
        where.isPrivate = false
      }
    }

    const count = await prisma.task.count({ where })
    return count

  } catch (error) {
    log.error({ listId: listId, error }, 'Error counting tasks for list')
    return 0
  }
}

/**
 * Get accurate task counts for multiple lists efficiently
 */
export async function getMultipleListTaskCounts(
  listIds: string[],
  options: TaskCountOptions = {}
): Promise<Record<string, number>> {
  const {
    includeCompleted = true,
    includePrivate = true,
    isPublicContext = false
  } = options

  try {
    // Build the where clause for task filtering
    const taskWhere: any = {}

    if (isPublicContext) {
      taskWhere.isPrivate = false
      if (!includeCompleted) {
        taskWhere.completed = false
      }
    } else {
      if (!includeCompleted) {
        taskWhere.completed = false
      }
      if (!includePrivate) {
        taskWhere.isPrivate = false
      }
    }

    // Use a more efficient approach: get all relevant tasks with their list associations
    const tasks = await prisma.task.findMany({
      where: {
        ...taskWhere,
        lists: {
          some: {
            id: {
              in: listIds
            }
          }
        }
      },
      select: {
        id: true,
        lists: {
          select: {
            id: true
          },
          where: {
            id: {
              in: listIds
            }
          }
        }
      }
    })

    // Count tasks per list
    const counts: Record<string, number> = {}
    listIds.forEach(listId => {
      counts[listId] = 0
    })

    tasks.forEach(task => {
      task.lists.forEach(list => {
        if (listIds.includes(list.id)) {
          counts[list.id]++
        }
      })
    })

    return counts

  } catch (error) {
    log.error({ err: error }, 'Error counting tasks for multiple lists:')
    return listIds.reduce((acc, listId) => {
      acc[listId] = 0
      return acc
    }, {} as Record<string, number>)
  }
}

/**
 * Enhanced Prisma include for consistent task counting
 */
export function getTaskCountInclude(options: TaskCountOptions = {}) {
  const {
    includeCompleted = true,
    includePrivate = true,
    isPublicContext = false
  } = options

  const where: any = {}

  if (isPublicContext) {
    where.isPrivate = false
    if (!includeCompleted) {
      where.completed = false
    }
  } else {
    if (!includeCompleted) {
      where.completed = false
    }
    if (!includePrivate) {
      where.isPrivate = false
    }
  }

  return {
    _count: {
      select: {
        tasks: {
          where
        }
      }
    }
  }
}