/**
 * List CRUD operations for MCP API
 */

import { prisma } from "@/lib/prisma"
import { broadcastToUsers } from "@/lib/sse-utils"
import { getErrorMessage } from "@/lib/error-utils"
import { hydrateListFavorites, hydrateSingleListFavorite, toggleFavorite } from "@/lib/favorites"
import { createLogger } from '@/lib/logger'
import {
  validateMCPToken,
  getListMemberIdsByListId,
  getTokenAccessLevel,
  determinePermissions,
  maskToken
} from "./shared"

const log = createLogger('mcp.list-operations')

export async function getSharedLists(accessToken: string, userId: string) {
  log.info({ token: maskToken(accessToken) }, 'MCP [getSharedLists] called')
  const mcpToken = await validateMCPToken(accessToken)
  log.info({ userId: mcpToken.userId }, 'MCP [getSharedLists] MCP token validated')

  // Get all lists accessible to the token owner (token-level permissions control access)
  const lists = await prisma.taskList.findMany({
    where: {
      OR: [
        { ownerId: mcpToken.userId },
        { listMembers: { some: { userId: mcpToken.userId } } }
      ]
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true }
      },
      listMembers: {
        include: {
          user: { select: { id: true, name: true, email: true } }
        }
      },
      listInvites: {
        select: { id: true, listId: true, email: true, role: true, token: true, createdAt: true, createdBy: true }
      },
      _count: {
        select: { tasks: true }
      }
    }
  })
  log.info(lists.length, 'MCP [getSharedLists] Accessible lists:')

  // Debug: Log member information for first list
  if (lists.length > 0) {
    const firstList = lists[0]
    log.info({
      owner: firstList.owner?.name || 'null',
      listMembers: firstList.listMembers?.length || 0,
      invitations: firstList.listInvites?.length || 0,
    }, 'MCP [getSharedLists] First list member data')
  }

  // Hydrate per-user favorite state
  await hydrateListFavorites(lists, mcpToken.userId)

  return {
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description || '',
      color: list.color || '#3b82f6',
      privacy: list.privacy,
      isFavorite: list.isFavorite,
      favoriteOrder: list.favoriteOrder,
      owner: list.owner,
      listMembers: list.listMembers,
      invitations: list.listInvites,
      taskCount: list._count.tasks,
      permissions: determinePermissions(list, mcpToken.userId),
      mcpAccessLevel: getTokenAccessLevel(determinePermissions(list, mcpToken.userId)),
      // Virtual list (saved filter) settings
      isVirtual: list.isVirtual,
      virtualListType: list.virtualListType,
      // Sort and filter settings
      sortBy: list.sortBy,
      manualSortOrder: list.manualSortOrder,
      filterPriority: list.filterPriority,
      filterAssignee: list.filterAssignee,
      filterDueDate: list.filterDueDate,
      filterCompletion: list.filterCompletion,
      filterRepeating: list.filterRepeating,
      filterAssignedBy: list.filterAssignedBy,
      filterInLists: list.filterInLists,
      // List default task settings
      defaultPriority: list.defaultPriority,
      defaultDueDate: list.defaultDueDate,
      defaultDueTime: list.defaultDueTime,
      defaultIsPrivate: list.defaultIsPrivate,
      defaultRepeating: list.defaultRepeating,
      defaultAssigneeId: list.defaultAssigneeId,
      // AI agent settings
      aiAstridEnabled: list.aiAstridEnabled,
      preferredAiProvider: list.preferredAiProvider,
      fallbackAiProvider: list.fallbackAiProvider,
      githubRepositoryId: list.githubRepositoryId,
      aiAgentsEnabled: list.aiAgentsEnabled,
      aiAgentConfiguredBy: list.aiAgentConfiguredBy,
      copyCount: list.copyCount
    }))
  }
}

export async function getPublicLists(
  accessToken: string,
  limit: number = 10,
  sortBy: string = 'popular',
  userId: string
) {
  const mcpToken = await validateMCPToken(accessToken)

  // Import the public list utilities
  const { getPopularPublicLists, getRecentPublicLists } = await import('@/lib/copy-utils')

  try {
    let publicLists

    if (sortBy === 'recent') {
      publicLists = await getRecentPublicLists(limit)
    } else {
      // Default to popular
      publicLists = await getPopularPublicLists(limit)
    }

    return {
      success: true,
      lists: publicLists,
      count: publicLists.length
    }
  } catch (error: unknown) {
    log.error({ err: error }, '[MCP] Failed to get public lists:')
    throw new Error(`Failed to get public lists: ${getErrorMessage(error)}`)
  }
}

export async function copyPublicList(
  accessToken: string,
  listId: string,
  includeTasks: boolean = true,
  userId: string
) {
  const mcpToken = await validateMCPToken(accessToken)

  // Import the copy utility
  const { copyListWithTasks } = await import('@/lib/copy-utils')

  try {
    const result = await copyListWithTasks(listId, {
      newOwnerId: mcpToken.userId,
      includeTasks,
      preserveTaskAssignees: false,
      assignToUser: true,
      newOwnerName: mcpToken.user.name || mcpToken.user.email || undefined
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to copy list')
    }

    return {
      success: true,
      list: result.copiedList,
      copiedTasksCount: result.copiedTasksCount,
      message: `List copied successfully with ${result.copiedTasksCount} tasks`
    }
  } catch (error: unknown) {
    log.error({ err: error }, '[MCP] Failed to copy list:')
    throw new Error(`Failed to copy list: ${getErrorMessage(error)}`)
  }
}

export async function createList(accessToken: string, listData: any, userId: string) {
  const mcpToken = await validateMCPToken(accessToken)

  // Verify user has MCP enabled
  const user = await prisma.user.findFirst({
    where: {
      id: mcpToken.userId,
      mcpEnabled: true
    }
  })

  if (!user) {
    throw new Error('MCP access not enabled for user')
  }

  // Create the list first to get the ID, then assign consistent default image
  let list = await prisma.taskList.create({
    data: {
      name: listData.name,
      description: listData.description || '',
      color: listData.color || '#3b82f6',
      privacy: listData.privacy || 'PRIVATE',
      imageUrl: listData.imageUrl, // Use provided imageUrl or null
      ownerId: mcpToken.userId,
      mcpAccessLevel: 'BOTH' // Token-level permissions control access
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true }
      },
      _count: {
        select: { tasks: true }
      }
    }
  })

  // If no imageUrl was provided, assign a consistent default based on the list ID
  if (!list.imageUrl) {
    const { getConsistentDefaultImage } = await import('@/lib/default-images')
    const consistentImage = getConsistentDefaultImage(list.id)
    list = await prisma.taskList.update({
      where: { id: list.id },
      data: { imageUrl: consistentImage.filename },
      include: {
        owner: {
          select: { id: true, name: true, email: true }
        },
        _count: {
          select: { tasks: true }
        }
      }
    })
  }

  return {
    success: true,
    list: {
      id: list.id,
      name: list.name,
      description: list.description,
      color: list.color,
      privacy: list.privacy,
      isFavorite: list.isFavorite,
      favoriteOrder: list.favoriteOrder,
      owner: list.owner,
      taskCount: list._count.tasks,
      mcpEnabled: true, // Token-level permissions control access
      mcpAccessLevel: getTokenAccessLevel(determinePermissions(list, mcpToken.userId)),
      createdAt: list.createdAt
    }
  }
}

export async function updateList(accessToken: string, listId: string, updates: any, userId: string) {
  const mcpToken = await validateMCPToken(accessToken, listId)

  // Find list and verify ownership or admin access
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: mcpToken.userId },
        { listMembers: { some: { userId: mcpToken.userId } } }
      ]
    }
  })

  if (!list) {
    throw new Error('List not found or insufficient permissions')
  }

  // Handle isFavorite via per-user table
  if (updates.isFavorite !== undefined) {
    await toggleFavorite(mcpToken.userId, listId, updates.isFavorite)
  }

  const updatedList = await prisma.taskList.update({
    where: { id: listId },
    data: {
      ...(updates.name && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.color && { color: updates.color }),
      ...(updates.privacy && { privacy: updates.privacy }),
      // Virtual list (saved filter) settings
      ...(updates.isVirtual !== undefined && { isVirtual: updates.isVirtual }),
      ...(updates.virtualListType !== undefined && { virtualListType: updates.virtualListType }),
      // Sort and filter settings
      ...(updates.sortBy !== undefined && { sortBy: updates.sortBy }),
      ...(updates.manualSortOrder !== undefined && { manualSortOrder: updates.manualSortOrder }),
      ...(updates.filterPriority !== undefined && { filterPriority: updates.filterPriority }),
      ...(updates.filterAssignee !== undefined && { filterAssignee: updates.filterAssignee }),
      ...(updates.filterDueDate !== undefined && { filterDueDate: updates.filterDueDate }),
      ...(updates.filterCompletion !== undefined && { filterCompletion: updates.filterCompletion }),
      ...(updates.filterRepeating !== undefined && { filterRepeating: updates.filterRepeating }),
      ...(updates.filterAssignedBy !== undefined && { filterAssignedBy: updates.filterAssignedBy }),
      ...(updates.filterInLists !== undefined && { filterInLists: updates.filterInLists }),
      // Default task settings
      ...(updates.defaultPriority !== undefined && { defaultPriority: updates.defaultPriority }),
      ...(updates.defaultDueDate !== undefined && { defaultDueDate: updates.defaultDueDate }),
      ...(updates.defaultDueTime !== undefined && { defaultDueTime: updates.defaultDueTime }),
      ...(updates.defaultIsPrivate !== undefined && { defaultIsPrivate: updates.defaultIsPrivate }),
      ...(updates.defaultRepeating !== undefined && { defaultRepeating: updates.defaultRepeating }),
      ...(updates.defaultAssigneeId !== undefined && { defaultAssigneeId: updates.defaultAssigneeId }),
      // AI agent settings
      ...(updates.aiAstridEnabled !== undefined && { aiAstridEnabled: updates.aiAstridEnabled }),
      ...(updates.aiAgentConfiguredBy !== undefined && { aiAgentConfiguredBy: updates.aiAgentConfiguredBy }),
      ...(updates.preferredAiProvider !== undefined && { preferredAiProvider: updates.preferredAiProvider }),
      ...(updates.fallbackAiProvider !== undefined && { fallbackAiProvider: updates.fallbackAiProvider }),
      ...(updates.githubRepositoryId !== undefined && { githubRepositoryId: updates.githubRepositoryId }),
      ...(updates.aiAgentsEnabled !== undefined && { aiAgentsEnabled: updates.aiAgentsEnabled }),
      // Note: copyCount is read-only (auto-incremented by copy operation)
      // Note: mcpAccessLevel is now controlled at the token level, not list level
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true }
      },
      listMembers: {
        include: {
          user: { select: { id: true, name: true, email: true } }
        }
      },
      _count: {
        select: { tasks: true }
      }
    }
  })

  // Hydrate per-user favorite state
  await hydrateSingleListFavorite(updatedList, mcpToken.userId)

  return {
    success: true,
    list: {
      id: updatedList.id,
      name: updatedList.name,
      description: updatedList.description,
      color: updatedList.color,
      privacy: updatedList.privacy,
      isFavorite: updatedList.isFavorite,
      favoriteOrder: updatedList.favoriteOrder,
      owner: updatedList.owner,
      listMembers: updatedList.listMembers,
      taskCount: updatedList._count.tasks,
      mcpEnabled: true, // Token-level permissions control access
      mcpAccessLevel: getTokenAccessLevel(determinePermissions(updatedList, mcpToken.userId)),
      updatedAt: updatedList.updatedAt,
      // Virtual list (saved filter) settings
      isVirtual: updatedList.isVirtual,
      virtualListType: updatedList.virtualListType,
      // Sort and filter settings
      sortBy: updatedList.sortBy,
      manualSortOrder: updatedList.manualSortOrder,
      filterPriority: updatedList.filterPriority,
      filterAssignee: updatedList.filterAssignee,
      filterDueDate: updatedList.filterDueDate,
      filterCompletion: updatedList.filterCompletion,
      filterRepeating: updatedList.filterRepeating,
      filterAssignedBy: updatedList.filterAssignedBy,
      filterInLists: updatedList.filterInLists,
      // Default task settings
      defaultPriority: updatedList.defaultPriority,
      defaultDueDate: updatedList.defaultDueDate,
      defaultDueTime: updatedList.defaultDueTime,
      defaultIsPrivate: updatedList.defaultIsPrivate,
      defaultRepeating: updatedList.defaultRepeating,
      defaultAssigneeId: updatedList.defaultAssigneeId,
      // AI agent settings
      aiAstridEnabled: updatedList.aiAstridEnabled,
      preferredAiProvider: updatedList.preferredAiProvider,
      fallbackAiProvider: updatedList.fallbackAiProvider,
      githubRepositoryId: updatedList.githubRepositoryId,
      aiAgentsEnabled: updatedList.aiAgentsEnabled,
      aiAgentConfiguredBy: updatedList.aiAgentConfiguredBy,
      copyCount: updatedList.copyCount
    }
  }
}

export async function deleteList(accessToken: string, listId: string, userId: string) {
  const mcpToken = await validateMCPToken(accessToken, listId)

  // Find list and verify ownership (only owner can delete)
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      ownerId: mcpToken.userId
    },
    include: {
      _count: {
        select: { tasks: true }
      }
    }
  })

  if (!list) {
    throw new Error('List not found or you must be the owner to delete it')
  }

  // Delete the list (cascades to tasks via Prisma schema)
  await prisma.taskList.delete({
    where: { id: listId }
  })

  // Broadcast SSE event for real-time updates
  try {
    const userIds = await getListMemberIdsByListId(listId)

    if (userIds.length > 0) {
      log.info(`[MCP SSE] Broadcasting list_deleted to ${userIds.length} users`)
      await broadcastToUsers(userIds, {
        type: 'list_deleted',
        timestamp: new Date().toISOString(),
        data: {
          listId: list.id,
          listName: list.name,
          deleterName: mcpToken.user.name || mcpToken.user.email || "MCP Agent",
          userId: mcpToken.userId
        }
      })
    }
  } catch (error) {
    log.error({ err: error }, '[MCP SSE] Failed to broadcast list_deleted:')
    // Don't fail the operation if SSE fails
  }

  return {
    success: true,
    message: 'List deleted successfully'
  }
}
