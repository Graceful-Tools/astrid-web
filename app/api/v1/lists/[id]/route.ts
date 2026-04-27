/**
 * Individual List API v1
 *
 * GET /api/v1/lists/:id - Get single list
 * PUT /api/v1/lists/:id - Update list
 * DELETE /api/v1/lists/:id - Delete list
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { hydrateSingleListFavorite, toggleFavorite } from '@/lib/favorites'
import { withAuth } from '@/lib/api-auth-wrapper'

type RouteContext = { params: Promise<{ id: string }> }

const FILTER_FIELDS = [
  'sortBy', 'manualSortOrder', 'filterPriority', 'filterAssignee',
  'filterDueDate', 'filterCompletion', 'filterRepeating',
  'filterAssignedBy', 'filterInLists', 'isFavorite'
] as const

/**
 * GET /api/v1/lists/:id
 * Get a single list by ID
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.id' },
  async (_req, auth, { params }) => {
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
        _count: { select: { tasks: true } }
      }
    })

    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

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
          createdAt: list.createdAt,
          updatedAt: list.updatedAt
        },
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)

/**
 * PUT /api/v1/lists/:id
 * Update a list
 */
export const PUT = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.id' },
  async (req, auth, { params }) => {
    const { id } = await params
    const body = await req.json()

    const isFilterOnlyUpdate = Object.keys(body).every(key =>
      (FILTER_FIELDS as readonly string[]).includes(key)
    )

    // Filter-only updates: any member. Other updates: owner/admin only.
    const existingList = await prisma.taskList.findFirst({
      where: {
        id,
        OR: isFilterOnlyUpdate
          ? [
              { ownerId: auth.userId },
              { listMembers: { some: { userId: auth.userId } } }
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

    const isOwnerOrAdmin = existingList.ownerId === auth.userId ||
      await prisma.listMember.findFirst({
        where: { listId: id, userId: auth.userId, role: 'ADMIN' }
      })

    const updateData: any = {}

    if (isOwnerOrAdmin) {
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

    // isFavorite lives in a per-user table, not on TaskList
    if (body.isFavorite !== undefined) {
      await toggleFavorite(auth.userId, id, body.isFavorite)
    }

    // Filter fields — allowed for any member
    if (body.sortBy !== undefined) updateData.sortBy = body.sortBy
    if (body.manualSortOrder !== undefined) updateData.manualSortOrder = body.manualSortOrder
    if (body.filterPriority !== undefined) updateData.filterPriority = body.filterPriority
    if (body.filterAssignee !== undefined) updateData.filterAssignee = body.filterAssignee
    if (body.filterDueDate !== undefined) updateData.filterDueDate = body.filterDueDate
    if (body.filterCompletion !== undefined) updateData.filterCompletion = body.filterCompletion
    if (body.filterRepeating !== undefined) updateData.filterRepeating = body.filterRepeating
    if (body.filterAssignedBy !== undefined) updateData.filterAssignedBy = body.filterAssignedBy
    if (body.filterInLists !== undefined) updateData.filterInLists = body.filterInLists

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
        _count: { select: { tasks: true } }
      },
    })

    await hydrateSingleListFavorite(list, auth.userId)

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
          defaultDueTime: list.defaultDueTime,
          githubRepositoryId: list.githubRepositoryId,
          preferredAiProvider: list.preferredAiProvider,
          createdAt: list.createdAt,
          updatedAt: list.updatedAt
        },
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)

/**
 * DELETE /api/v1/lists/:id
 * Delete a list (owner only)
 */
export const DELETE = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.id' },
  async (req, auth, { params }) => {
    const { id } = await params

    const existingList = await prisma.taskList.findFirst({
      where: { id, ownerId: auth.userId }
    })

    if (!existingList) {
      return NextResponse.json(
        { error: 'List not found or you must be the owner to delete' },
        { status: 404 }
      )
    }

    await prisma.taskList.delete({ where: { id } })

    trackEventFromRequest(req, auth.userId, AnalyticsEventType.LIST_DELETED, { listId: id })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'List deleted successfully',
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)
