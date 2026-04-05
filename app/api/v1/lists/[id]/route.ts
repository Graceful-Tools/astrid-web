/**
 * Individual List API v1
 *
 * GET /api/v1/lists/:id - Get single list
 * PUT /api/v1/lists/:id - Update list
 * DELETE /api/v1/lists/:id - Delete list
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { hydrateSingleListFavorite, toggleFavorite } from '@/lib/favorites'

/**
 * GET /api/v1/lists/:id
 * Get a single list by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:read'])

    const { id } = await params

    const list = await prisma.taskList.findFirst({
      where: {
        id,
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
        _count: {
          select: { tasks: true }
        }
      }
    })

    if (!list) {
      return NextResponse.json(
        { error: 'List not found' },
        { status: 404 }
      )
    }

    // Hydrate per-user favorite state
    await hydrateSingleListFavorite(list, auth.userId)

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        list: {
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
          taskCount: list._count.tasks,
          // Virtual list settings
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
          // List defaults
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
        },
        meta: {
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
    console.error('[API v1] GET /lists/:id error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/v1/lists/:id
 * Update a list
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:write'])

    const { id } = await params
    const body = await req.json()

    // Check what kind of update this is
    const isFilterOnlyUpdate = Object.keys(body).every(key =>
      ['sortBy', 'manualSortOrder', 'filterPriority', 'filterAssignee',
       'filterDueDate', 'filterCompletion', 'filterRepeating',
       'filterAssignedBy', 'filterInLists', 'isFavorite'].includes(key)
    )

    // For filter-only updates, allow any member. For other updates, require owner/admin.
    const existingList = await prisma.taskList.findFirst({
      where: {
        id,
        OR: isFilterOnlyUpdate
          ? [
              { ownerId: auth.userId },
              { listMembers: { some: { userId: auth.userId } } }  // Any member can update filters
            ]
          : [
              { ownerId: auth.userId },
              { listMembers: { some: { userId: auth.userId, role: 'ADMIN' } } }
            ]
      }
    })

    if (!existingList) {
      return NextResponse.json(
        { error: 'List not found or insufficient permissions' },
        { status: 404 }
      )
    }

    // If not owner/admin, only allow filter updates
    const isOwnerOrAdmin = existingList.ownerId === auth.userId ||
      await prisma.listMember.findFirst({
        where: { listId: id, userId: auth.userId, role: 'ADMIN' }
      })

    // Build update data - restrict non-admin members to filter fields only
    const filterFields = ['sortBy', 'manualSortOrder', 'filterPriority', 'filterAssignee',
      'filterDueDate', 'filterCompletion', 'filterRepeating', 'filterAssignedBy',
      'filterInLists', 'isFavorite']

    const updateData: any = {}

    if (isOwnerOrAdmin) {
      // Owner/admin can update everything
      if (body.name !== undefined) updateData.name = body.name
      if (body.description !== undefined) updateData.description = body.description
      if (body.color !== undefined) updateData.color = body.color
      if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl
      if (body.privacy !== undefined) updateData.privacy = body.privacy
      if (body.defaultAssigneeId !== undefined) updateData.defaultAssigneeId = body.defaultAssigneeId
      if (body.defaultPriority !== undefined) updateData.defaultPriority = body.defaultPriority
      if (body.defaultRepeating !== undefined) updateData.defaultRepeating = body.defaultRepeating
      if (body.defaultIsPrivate !== undefined) updateData.defaultIsPrivate = body.defaultIsPrivate
      if (body.defaultDueDate !== undefined) updateData.defaultDueDate = body.defaultDueDate
      if (body.defaultDueTime !== undefined) updateData.defaultDueTime = body.defaultDueTime
      if (body.isVirtual !== undefined) updateData.isVirtual = body.isVirtual
      if (body.virtualListType !== undefined) updateData.virtualListType = body.virtualListType
      if (body.githubRepositoryId !== undefined) updateData.githubRepositoryId = body.githubRepositoryId
      if (body.preferredAiProvider !== undefined) updateData.preferredAiProvider = body.preferredAiProvider
    }

    // Handle isFavorite via per-user table (not on TaskList)
    if (body.isFavorite !== undefined) {
      await toggleFavorite(auth.userId, id, body.isFavorite)
    }

    // Filter fields - allowed for all members
    if (body.sortBy !== undefined) updateData.sortBy = body.sortBy
    if (body.manualSortOrder !== undefined) updateData.manualSortOrder = body.manualSortOrder
    if (body.filterPriority !== undefined) updateData.filterPriority = body.filterPriority
    if (body.filterAssignee !== undefined) updateData.filterAssignee = body.filterAssignee
    if (body.filterDueDate !== undefined) updateData.filterDueDate = body.filterDueDate
    if (body.filterCompletion !== undefined) updateData.filterCompletion = body.filterCompletion
    if (body.filterRepeating !== undefined) updateData.filterRepeating = body.filterRepeating
    if (body.filterAssignedBy !== undefined) updateData.filterAssignedBy = body.filterAssignedBy
    if (body.filterInLists !== undefined) updateData.filterInLists = body.filterInLists

    // Update list
    const list = await prisma.taskList.update({
      where: { id },
      data: updateData,
      include: {
        owner: {
          select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true }
        },
        listMembers: {
          include: {
            user: { select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true } }
          }
        },
        _count: {
          select: { tasks: true }
        }
      },
    })

    // Hydrate per-user favorite state
    await hydrateSingleListFavorite(list, auth.userId)

    // Track analytics
    trackEventFromRequest(req, auth.userId, AnalyticsEventType.LIST_EDITED, { listId: id })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        list: {
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
          taskCount: list._count.tasks,
          // Virtual list settings
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
          // List defaults
          defaultPriority: list.defaultPriority,
          defaultRepeating: list.defaultRepeating,
          defaultAssigneeId: list.defaultAssigneeId,
          defaultIsPrivate: list.defaultIsPrivate,
          defaultDueDate: list.defaultDueDate,
          defaultDueTime: list.defaultDueTime,
          // Coding agent configuration
          githubRepositoryId: list.githubRepositoryId,
          preferredAiProvider: list.preferredAiProvider,
          // Timestamps
          createdAt: list.createdAt,
          updatedAt: list.updatedAt
        },
        meta: {
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
    console.error('[API v1] PUT /lists/:id error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/lists/:id
 * Delete a list (owner only)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:write'])

    const { id } = await params

    // Check if user is the owner
    const existingList = await prisma.taskList.findFirst({
      where: {
        id,
        ownerId: auth.userId
      }
    })

    if (!existingList) {
      return NextResponse.json(
        { error: 'List not found or you must be the owner to delete' },
        { status: 404 }
      )
    }

    // Delete list
    await prisma.taskList.delete({
      where: { id }
    })

    // Track analytics
    trackEventFromRequest(req, auth.userId, AnalyticsEventType.LIST_DELETED, { listId: id })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'List deleted successfully',
        meta: {
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
    console.error('[API v1] DELETE /lists/:id error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
