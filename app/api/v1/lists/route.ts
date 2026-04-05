/**
 * Lists API v1
 *
 * RESTful endpoint for list operations
 * GET /api/v1/lists - List all accessible lists
 * POST /api/v1/lists - Create list
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { getTaskCountInclude, getMultipleListTaskCounts } from '@/lib/task-count-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { hydrateListFavorites } from '@/lib/favorites'

/**
 * GET /api/v1/lists
 * Get all lists accessible to the authenticated user
 *
 * Returns lists where user is:
 * - Owner
 * - Member
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:read'])

    // Get all lists accessible to the user
    const lists = await prisma.taskList.findMany({
      where: {
        OR: [
          { ownerId: auth.userId },
          { listMembers: { some: { userId: auth.userId } } }
        ]
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
        listInvites: {
          select: { id: true, listId: true, email: true, role: true, token: true, createdAt: true, createdBy: true }
        },
        ...getTaskCountInclude({ includeCompleted: false })
      }
    })

    // Hydrate per-user favorite state
    await hydrateListFavorites(lists, auth.userId)

    // Get accurate incomplete task counts for all lists
    const listIds = lists.map(list => list.id)
    const taskCounts = await getMultipleListTaskCounts(listIds, { includeCompleted: false })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        lists: lists.map((list: any) => ({
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
          defaultRepeating: list.defaultRepeating,
          defaultAssigneeId: list.defaultAssigneeId,
          defaultIsPrivate: list.defaultIsPrivate,
          defaultDueDate: list.defaultDueDate,
          // Coding agent configuration
          githubRepositoryId: list.githubRepositoryId,
          preferredAiProvider: list.preferredAiProvider,
          // Timestamps
          createdAt: list.createdAt,
          updatedAt: list.updatedAt
        })),
        meta: {
          total: lists.length,
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      )
    }
    console.error('[API v1] GET /lists error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/v1/lists
 * Create a new list
 *
 * Body:
 * {
 *   name: string (required)
 *   description?: string
 *   color?: string
 *   imageUrl?: string
 *   privacy?: 'PRIVATE' | 'SHARED'
 *   adminIds?: string[]
 *   memberIds?: string[]
 *   memberEmails?: string[]
 *   defaultAssigneeId?: string
 *   defaultPriority?: number
 *   defaultRepeating?: string
 *   defaultIsPrivate?: boolean
 *   defaultDueDate?: ISO datetime string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:write'])

    const body = await req.json()

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'name is required and must be a string' },
        { status: 400 }
      )
    }

    // Create list
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
        // Coding agent configuration
        githubRepositoryId: body.githubRepositoryId,
        preferredAiProvider: body.preferredAiProvider,
        // Add members if provided
        listMembers: body.memberIds?.length
          ? {
              create: body.memberIds.map((userId: string) => ({
                userId,
                role: 'MEMBER' as const,
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

    // Get accurate incomplete task count
    const taskCount = await getMultipleListTaskCounts([list.id], { includeCompleted: false })

    // Track analytics
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
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      )
    }
    console.error('[API v1] POST /lists error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
