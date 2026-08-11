/**
 * Lists API v1
 *
 * RESTful endpoint for list operations
 * GET /api/v1/lists - List all accessible lists
 * POST /api/v1/lists - Create list
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { getTaskCountInclude, getMultipleListTaskCounts } from '@/lib/task-count-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { hydrateListFavorites } from '@/lib/favorites'
import { RedisCache } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import type { V1List } from '@/lib/api-contracts/v1-ios-shapes'
import { listVisibilityWhere } from '@/lib/list-permissions'
import { DEFAULT_LIST_SHOW_SUBTASKS } from '@/lib/list-subtask-visibility'
import { getDeletionsSince } from '@/lib/deletion-log'

const log = createLogger('v1.lists')

const LISTS_CACHE_TTL_SECONDS = 300 // matches the legacy /api/lists cache

/**
 * GET /api/v1/lists
 * Get all lists accessible to the authenticated user.
 *
 * Query params:
 * - updatedSince (ISO 8601): if set, return only lists updated after this
 *   timestamp and skip the cache (incremental sync). Without this param the
 *   response is cached in Redis for 5 minutes; mutation paths invalidate
 *   via RedisCache.invalidate.userLists which wipes both this and the
 *   legacy cache key (pattern: `lists:user:${userId}*`).
 */
export const GET = withAuth(
  { scopes: ['lists:read'], tag: 'v1.lists' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const updatedSince = searchParams.get('updatedSince')

    // Project-derived visibility (task 6c20d125). Keeps this route's long-standing
    // exclusion of PUBLIC lists — iOS syncs only lists the user belongs to.
    const baseWhere = listVisibilityWhere(auth.userId, { includePublic: false })

    const where = updatedSince
      ? { ...baseWhere, updatedAt: { gt: new Date(updatedSince) } }
      : baseWhere

    const fetchLists = () =>
      prisma.taskList.findMany({
        where,
        include: {
          owner: {
            select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true }
          },
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true } }
            }
          },
          listInvites: {
            select: { id: true, listId: true, email: true, role: true, token: true, createdAt: true, createdBy: true }
          },
          ...getTaskCountInclude({ includeCompleted: false })
        },
        orderBy: updatedSince ? { updatedAt: 'desc' } : undefined,
      })

    // Cache only full syncs — incremental requests bypass cache so clients
    // always see the freshest delta.
    const lists = updatedSince
      ? await fetchLists()
      : await RedisCache.getOrSet(
          RedisCache.keys.userListsV1(auth.userId),
          fetchLists,
          LISTS_CACHE_TTL_SECONDS
        )

    await hydrateListFavorites(lists, auth.userId)

    const listIds = lists.map(list => list.id)
    const taskCounts = await getMultipleListTaskCounts(listIds, { includeCompleted: false })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    const responseTimestamp = new Date().toISOString()

    const deletedListIds = updatedSince
      ? await getDeletionsSince('list', auth.userId, new Date(updatedSince))
      : undefined

    return NextResponse.json(
      {
        // Bound to the iOS contract: if a future edit drops or renames a key
        // iOS decodes, tsc fails here rather than the app breaking at runtime.
        lists: lists.map((list: any): V1List => ({
          id: list.id,
          name: list.name,
          description: list.description || '',
          color: list.color || '#3b82f6',
          imageUrl: list.imageUrl,
          privacy: list.privacy,
          isFavorite: list.isFavorite,
          favoriteOrder: list.favoriteOrder,
          owner: list.owner,
          listMembers: list.listMembers,
          invitations: list.listInvites,
          taskCount: taskCounts[list.id] || 0,
          isVirtual: list.isVirtual,
          virtualListType: list.virtualListType,
          sortBy: list.sortBy,
          manualSortOrder: list.manualSortOrder,
          filterPriority: list.filterPriority,
          filterAssignee: list.filterAssignee,
          filterDueDate: list.filterDueDate,
          filterCompletion: list.filterCompletion,
          filterRepeating: list.filterRepeating,
          filterAssignedBy: list.filterAssignedBy,
          filterInLists: list.filterInLists,
          defaultPriority: list.defaultPriority,
          defaultRepeating: list.defaultRepeating,
          defaultAssigneeId: list.defaultAssigneeId,
          defaultIsPrivate: list.defaultIsPrivate,
          defaultDueDate: list.defaultDueDate,
          githubRepositoryId: list.githubRepositoryId,
          preferredAiProvider: list.preferredAiProvider,
          projectId: list.projectId ?? null,
          listType: list.listType ?? 'regular',
          statusRole: list.statusRole ?? null,
          statusOrder: list.statusOrder ?? null,
          statusDescription: list.statusDescription ?? null,
          statusCompleted: list.statusCompleted ?? false,
          recentlyCompletedWindow: list.recentlyCompletedWindow ?? null,
          showSubtasks: list.showSubtasks ?? DEFAULT_LIST_SHOW_SUBTASKS,
          createdAt: list.createdAt,
          updatedAt: list.updatedAt
        })),
        // Deltas report deleted lists so a client can drop them. Lists are
        // hard-deleted, so without this an incremental sync leaves them on
        // screen. Absent on a full fetch, keeping that response unchanged.
        ...(deletedListIds ? { deletedIds: deletedListIds } : {}),
        meta: {
          total: lists.length,
          apiVersion: 'v1',
          authSource: auth.source,
          // Incremental-sync metadata: clients pass `timestamp` back as
          // `updatedSince` on the next poll to fetch only changed lists.
          timestamp: responseTimestamp,
          isIncremental: !!updatedSince,
        },
      },
      { headers }
    )
  }
)

/**
 * POST /api/v1/lists
 * Create a new list
 */
export const POST = withAuth(
  { scopes: ['lists:write'], tag: 'v1.lists' },
  async (req, auth) => {
    const body = await req.json()

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'name is required and must be a string' },
        { status: 400 }
      )
    }

    const list = await prisma.taskList.create({
      data: {
        name: body.name,
        description: body.description || '',
        color: body.color || '#3b82f6',
        imageUrl: body.imageUrl,
        privacy: body.privacy || 'PRIVATE',
        ownerId: auth.userId,
        defaultAssigneeId: body.defaultAssigneeId,
        defaultPriority: body.defaultPriority,
        defaultRepeating: body.defaultRepeating,
        defaultIsPrivate: body.defaultIsPrivate,
        defaultDueDate: body.defaultDueDate,
        githubRepositoryId: body.githubRepositoryId,
        preferredAiProvider: body.preferredAiProvider,
        listMembers: body.memberIds?.length
          ? {
              create: body.memberIds.map((userId: string) => ({
                userId,
                role: 'member' as const,
              })),
            }
          : undefined,
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true }
        },
        listMembers: {
          include: {
            user: { select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true } }
          }
        },
        ...getTaskCountInclude({ includeCompleted: false })
      },
    })

    const taskCount = await getMultipleListTaskCounts([list.id], { includeCompleted: false })

    // Invalidate user-lists cache for everyone who can see the new list.
    // Pattern delete (`lists:user:${userId}*`) wipes both the legacy
    // `/api/lists` cache and the v1 cache key in one shot.
    try {
      const memberIds: string[] = body.memberIds || []
      const userIdsToInvalidate = Array.from(new Set([auth.userId, ...memberIds]))
      await Promise.all(userIdsToInvalidate.map(uid => RedisCache.invalidate.userLists(uid)))
    } catch (invalidateError) {
      log.error({ err: invalidateError }, 'Failed to invalidate user-lists cache after POST')
    }

    trackEventFromRequest(req, auth.userId, AnalyticsEventType.LIST_ADDED, { listId: list.id })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        list: {
          ...list,
          taskCount: taskCount[list.id] || 0
        },
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { status: 201, headers }
    )
  }
)
