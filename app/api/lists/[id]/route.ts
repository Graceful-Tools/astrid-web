import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { getAllListMembers, hasListAccess } from "@/lib/list-member-utils"
import { RedisCache } from "@/lib/redis"
import { hydrateSingleListFavorite } from "@/lib/favorites"
import type { RouteContextParams } from "@/types/next"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"
import { createLogger } from '@/lib/logger'
import { canUserManageList } from "@/lib/list-permissions"
import { canConvertListFlavor } from "@/lib/list-flavors"
import { normalizeShowSubtasks } from "@/lib/list-subtask-visibility"
import { recordDeletion } from "@/lib/deletion-log"

const log = createLogger('api.lists.id')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        },
        tasks: {
          include: {
            assignee: true,
            creator: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Manually fetch defaultAssignee if it's a valid user ID (not "unassigned")
    let defaultAssignee = null
    if (list.defaultAssigneeId && list.defaultAssigneeId !== "unassigned") {
      defaultAssignee = await prisma.user.findUnique({
        where: { id: list.defaultAssigneeId }
      })
    }

    const listWithDefaultAssignee = {
      ...list,
      defaultAssignee
    }


    // Check if user has access to this list using comprehensive member utils
    // hasListAccess imported at top level
    const hasAccess = (session.user.id && hasListAccess(listWithDefaultAssignee as any, session.user.id)) || listWithDefaultAssignee.privacy === "PUBLIC"

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(listWithDefaultAssignee)
  } catch (error) {
    log.error({ err: error }, "Error fetching list:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const { id: listId } = await context.params

    // Check if user has permission to update this list
    const existingList = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        },
      },
    })

    if (!existingList) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user is owner or admin (via list membership).
    const canUpdate = canUserManageList({ id: session.user.id }, existingList as never)

    if (!canUpdate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Validate default assignee is a current member if specified
    if (data.defaultAssigneeId && data.defaultAssigneeId !== "unassigned") {
      // Check if the user exists
      const user = await prisma.user.findUnique({
        where: { id: data.defaultAssigneeId }
      })

      if (!user) {
        return NextResponse.json({ 
          error: "Default assignee user not found" 
        }, { status: 400 })
      }

      // Use the comprehensive member utility to check if user is a member
      const allMembers = getAllListMembers(existingList as any)
      const isMember = allMembers.some(member => member.id === data.defaultAssigneeId)

      if (!isMember) {
        return NextResponse.json({ 
          error: "Default assignee must be a current member of the list" 
        }, { status: 400 })
      }
    }

    let manualSortOrderUpdate: string[] | undefined
    if (data.sortBy === 'manual') {
      const tasksInList = await prisma.task.findMany({
        where: {
          lists: {
            some: {
              id: listId
            }
          }
        },
        select: {
          id: true,
          createdAt: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      })

      manualSortOrderUpdate = tasksInList.map(task => task.id)
    }

    // Flavor changes are limited to regular ⇄ label (task 60f5849d). listType
    // was previously writable unguarded, which let a caller turn any list into
    // a board column and silently violate the board's invariants (a task may
    // hold at most one status).
    if (data.listType !== undefined && data.listType !== existingList.listType) {
      if (!canConvertListFlavor(existingList.listType, data.listType)) {
        return NextResponse.json(
          { error: "Only regular and label lists can be converted between each other" },
          { status: 400 }
        )
      }
    }

    // Update the list
    const updateData: any = {
      name: data.name,
      description: data.description,
      color: data.color,
      imageUrl: data.imageUrl,
      projectId: data.projectId,
      listType: data.listType,
      statusRole: data.statusRole,
      statusOrder: data.statusOrder,
      statusDescription: data.statusDescription,
      statusCompleted: data.statusCompleted,
      privacy: data.privacy,
      publicListType: data.publicListType,
      defaultAssigneeId: data.defaultAssigneeId,
      defaultPriority: data.defaultPriority,
      defaultRepeating: data.defaultRepeating,
      defaultIsPrivate: data.defaultIsPrivate,
      defaultDueDate: data.defaultDueDate,
      defaultDueTime: data.defaultDueTime,
      // Filter settings
      filterCompletion: data.filterCompletion,
      recentlyCompletedWindow: data.recentlyCompletedWindow ?? null,
      filterDueDate: data.filterDueDate,
      filterAssignee: data.filterAssignee,
      filterAssignedBy: data.filterAssignedBy,
      filterRepeating: data.filterRepeating,
      filterPriority: data.filterPriority,
      filterInLists: data.filterInLists,
      sortBy: data.sortBy,
      virtualListType: data.virtualListType,
      isVirtual: data.isVirtual,
      aiAstridEnabled: data.aiAstridEnabled,
      mcpEnabled: data.mcpEnabled,
      mcpAccessLevel: data.mcpAccessLevel,
      // AI Coding Agent Configuration
      preferredAiProvider: data.preferredAiProvider,
      fallbackAiProvider: data.fallbackAiProvider,
      githubRepositoryId: data.githubRepositoryId,
      aiAgentsEnabled: data.aiAgentsEnabled,
    }

    // Per-list "show subtasks inline" (task dce843a1). Assigned separately
    // from the block above because the web client PUTs its whole TaskList
    // object here on every settings save — writing `data.showSubtasks`
    // unconditionally would reset the toggle on every unrelated edit made by
    // a client that hasn't been taught the field.
    const showSubtasks = normalizeShowSubtasks(data.showSubtasks)
    if (showSubtasks !== undefined) updateData.showSubtasks = showSubtasks

    if (data.sortBy === 'manual' && manualSortOrderUpdate) {
      updateData.manualSortOrder = manualSortOrderUpdate as Prisma.JsonArray
    }

    // Handle admin/member updates using ListMember table
    if (data.adminIds !== undefined) {
      // Remove all existing admin members
      await prisma.listMember.deleteMany({
        where: {
          listId: listId,
          role: 'admin'
        }
      })

      // Add new admins
      if (data.adminIds.length > 0) {
        await Promise.all(
          data.adminIds.map((userId: string) =>
            prisma.listMember.create({
              data: {
                listId: listId,
                userId: userId,
                role: 'admin'
              }
            })
          )
        )
      }
    }

    if (data.memberIds !== undefined) {
      // Remove all existing regular members
      await prisma.listMember.deleteMany({
        where: {
          listId: listId,
          role: 'member'
        }
      })

      // Add new members
      if (data.memberIds.length > 0) {
        await Promise.all(
          data.memberIds.map((userId: string) =>
            prisma.listMember.create({
              data: {
                listId: listId,
                userId: userId,
                role: 'member'
              }
            })
          )
        )
      }
    }

    // If changing privacy to PUBLIC, unassign all tasks
    if (data.privacy === 'PUBLIC' && existingList.privacy !== 'PUBLIC') {
      log.info(`🔓 List ${listId} becoming public - unassigning all tasks`)

      // Unassign all tasks in this list
      await prisma.task.updateMany({
        where: {
          lists: {
            some: {
              id: listId
            }
          }
        },
        data: {
          assigneeId: null
        }
      })

      log.info(`✅ Unassigned all tasks in list ${listId}`)
    }

    const updatedList = await prisma.taskList.update({
      where: { id: listId },
      data: updateData,
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    })

    // Manually fetch defaultAssignee if it's a valid user ID (not "unassigned")
    let defaultAssignee = null
    if (updatedList.defaultAssigneeId && updatedList.defaultAssigneeId !== "unassigned") {
      defaultAssignee = await prisma.user.findUnique({
        where: { id: updatedList.defaultAssigneeId }
      })
    }

    const updatedListWithDefaultAssignee = {
      ...updatedList,
      defaultAssignee
    }

    // Invalidate caches for all list members to ensure they see updates
    const { RedisCache } = await import('@/lib/redis')

    // Invalidate public lists cache if privacy changed to/from PUBLIC
    if (data.privacy === 'PUBLIC' || existingList.privacy === 'PUBLIC') {
      log.info(`🗑️ Invalidating public lists cache due to privacy change`)
      await RedisCache.delPattern('public_lists:*').catch(err =>
        log.error({ err: err }, 'Failed to invalidate public lists cache:')
      )
    }

    // ALWAYS invalidate user lists cache for all members to prevent stale data on SSE reconnect
    const allMembers = getAllListMembers(updatedListWithDefaultAssignee as any)
    const userIdsToInvalidate = [
      updatedListWithDefaultAssignee.ownerId,
      ...allMembers.map(m => m.id)
    ].filter((id, index, self) => id && self.indexOf(id) === index) // Dedupe

    log.info(`🗑️ Invalidating lists cache for ${userIdsToInvalidate.length} users after list update`)
    await Promise.all(
      userIdsToInvalidate.map(async (userId) => {
        try {
          await RedisCache.invalidate.userListsAllVersions(userId)
        } catch (error) {
          log.error({ err: error }, `❌ Failed to invalidate cache for user ${userId}:`)
        }
      })
    )

    // Broadcast SSE event for list update to all list members
    try {
      const allMembers = getAllListMembers(updatedListWithDefaultAssignee as any)
      const userIdsToNotify = [
        updatedListWithDefaultAssignee.ownerId, // Owner
        ...allMembers.map(member => member.id) // All members/admins
      ]

      // Remove the user who made the update (they already see it)
      const userIdsFiltered = userIdsToNotify.filter(userId => userId !== session.user.id)

      if (userIdsFiltered.length > 0) {
        // Strip per-user favorite fields — these are user-specific and must not
        // overwrite other users' favorite state via SSE
        const { isFavorite: _isFav, favoriteOrder: _favOrd, ...broadcastData } = updatedListWithDefaultAssignee
        log.info(`[SSE] Broadcasting list update to ${userIdsFiltered.length} users`)
        const { broadcastToUsers } = await import("@/lib/sse-utils")
        broadcastToUsers(userIdsFiltered, {
          type: 'list_updated',
          timestamp: new Date().toISOString(),
          data: broadcastData
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, "Failed to send list update SSE notifications:")
      // Continue - list was still updated
    }

    // Hydrate per-user favorite state for the calling user's response
    await hydrateSingleListFavorite(updatedListWithDefaultAssignee, session.user.id)

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.LIST_EDITED, { listId })

    return NextResponse.json(updatedListWithDefaultAssignee)
  } catch (error) {
    log.error({ err: error }, "Error updating list:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    // Check if user is the owner of this list
    const existingList = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        }
      }
    })

    if (!existingList) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    if (existingList.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Only the owner can delete a list" }, { status: 403 })
    }

    // Get all users who had access to this list before deletion for cache invalidation
    const allMembers = getAllListMembers(existingList as any)
    const userIdsToInvalidate = [
      existingList.ownerId, // Owner
      ...allMembers.map(member => member.id) // All members/admins
    ]

    // Best-effort sync bookkeeping — must never block the delete itself.
    try { await recordGoogleOptOutsForDeletedList(listId) } catch { /* tombstoning is belt-and-braces */ }
    await prisma.taskList.delete({
      where: { id: listId },
    })
    // Reuse the audience already gathered above for cache invalidation — the
    // same people are exactly who needs to hear the list is gone.
    await recordDeletion('list', listId, userIdsToInvalidate.filter(Boolean) as string[])

    // Invalidate cache for all users who had access to this list
    log.info({ userCount: userIdsToInvalidate.length }, "🗄️ Invalidating cache for users after list deletion")
    await Promise.all(
      userIdsToInvalidate.map(async (userId) => {
        try {
          await RedisCache.invalidate.userListsAllVersions(userId)
          log.info(`✅ Cache invalidated for user: ${userId}`)
        } catch (error) {
          log.error({ err: error }, `❌ Failed to invalidate cache for user ${userId}:`)
        }
      })
    )

    // Broadcast SSE event for list deletion to all list members
    try {
      // Remove the user who deleted the list (they already see it)
      const userIdsToNotify = userIdsToInvalidate.filter(userId => userId !== session.user.id)

      if (userIdsToNotify.length > 0) {
        log.info(`[SSE] Broadcasting list deletion to ${userIdsToNotify.length} users`)
        const { broadcastToUsers } = await import("@/lib/sse-utils")
        broadcastToUsers(userIdsToNotify, {
          type: 'list_deleted',
          timestamp: new Date().toISOString(),
          data: {
            id: listId,
            listId: listId,
            listName: existingList.name,
            deleterName: session.user.name || session.user.email || "Someone",
            userId: session.user.id
          }
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, "Failed to send list deletion SSE notifications:")
      // Continue - list was still deleted
    }

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.LIST_DELETED, { listId })

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "Error deleting list:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * A deleted list may mirror a Google tasklist that survives the delete — a
 * client in an all-lists auto-link mode would faithfully resurrect the list
 * from it. Record the tasklist as opted-out on every affected user's
 * integration BEFORE the cascade removes the link rows.
 */
async function recordGoogleOptOutsForDeletedList(listId: string) {
  const googleLinks = await prisma.externalListLink.findMany({
    where: { astridListId: listId, provider: 'GOOGLE_TASKS' },
  })
  for (const link of googleLinks) {
    const integration = await prisma.integration.findUnique({ where: { id: link.integrationId } })
    if (!integration || integration.revokedAt) continue
    const meta = (integration.metadata as Record<string, string> | null) || {}
    const excluded = new Set(String(meta.excludedTasklists || '').split(',').filter(Boolean))
    excluded.add(link.remoteContainerId)
    await prisma.integration.update({
      where: { id: integration.id },
      data: { metadata: { ...meta, excludedTasklists: Array.from(excluded).slice(-500).join(',') } },
    })
  }
}
