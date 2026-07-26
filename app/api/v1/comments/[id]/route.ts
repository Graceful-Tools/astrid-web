/**
 * Individual Comment API v1
 *
 * GET /api/v1/comments/:id - Get a single comment
 * PUT /api/v1/comments/:id - Update a comment
 * DELETE /api/v1/comments/:id - Delete a comment
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { hasExplicitListRole, canUserManageList } from "@/lib/list-permissions"

const log = createLogger('v1.comments.id')

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/comments/:id
 * Get a single comment by ID
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['comments:read'], tag: 'v1.comments.id' },
  async (_req, auth, { params }) => {
    const { id } = await params

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true }
        },
        secureFiles: true,
        task: {
          select: {
            id: true,
            creatorId: true,
            assigneeId: true,
            lists: {
              select: {
                id: true,
                ownerId: true,
                listMembers: {
                  select: { userId: true }
                }
              }
            }
          }
        }
      }
    })

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    // Verify user has access to the task
    const hasAccess =
      comment.task.creatorId === auth.userId ||
      comment.task.assigneeId === auth.userId ||
      comment.task.lists.some(
        (list: any) => hasExplicitListRole({ id: auth.userId }, list)
      )

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied to this comment' },
        { status: 403 }
      )
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    // Remove task from response (don't expose task data in comment endpoint)
    const { task: _task, ...commentData } = comment

    return NextResponse.json(
      {
        comment: commentData,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)

/**
 * PUT /api/v1/comments/:id
 * Update a comment (only the author can update)
 *
 * Body: { content: string (required) }
 */
export const PUT = withAuth<RouteContext>(
  { scopes: ['comments:write'], tag: 'v1.comments.id' },
  async (req, auth, { params }) => {
    const { id } = await params
    const body = await req.json()

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json(
        { error: 'content is required and must be a string' },
        { status: 400 }
      )
    }

    const existingComment = await prisma.comment.findUnique({
      where: { id },
      select: { authorId: true }
    })

    if (!existingComment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    if (existingComment.authorId !== auth.userId) {
      return NextResponse.json(
        { error: 'You can only edit your own comments' },
        { status: 403 }
      )
    }

    const comment = await prisma.comment.update({
      where: { id },
      data: { content: body.content, updatedAt: new Date() },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true }
        },
        secureFiles: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true
          }
        }
      }
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    return NextResponse.json(
      { comment, meta: { apiVersion: 'v1', authSource: auth.source } },
      { headers }
    )
  }
)

/**
 * DELETE /api/v1/comments/:id
 * Delete a comment (author, task creator, or list admin can delete)
 */
export const DELETE = withAuth<RouteContext>(
  { scopes: ['comments:delete'], tag: 'v1.comments.id' },
  async (req, auth, { params }) => {
    const { id } = await params

    const existingComment = await prisma.comment.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            creatorId: true,
            assigneeId: true,
            lists: {
              select: {
                id: true,
                name: true,
                ownerId: true,
                privacy: true,
                createdAt: true,
                updatedAt: true,
                owner: {
                  select: { id: true, email: true, name: true, image: true }
                },
                listMembers: {
                  select: {
                    userId: true,
                    role: true,
                    user: {
                      select: { id: true, email: true, name: true, image: true }
                    }
                  }
                }
              }
            }
          }
        },
        author: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    if (!existingComment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const task = existingComment.task

    // Check permissions: comment author OR task creator/assignee OR list owners/admins
    const isCommentAuthor = existingComment.authorId === auth.userId
    const isTaskCreator = task.creatorId === auth.userId
    const isTaskAssignee = task.assigneeId === auth.userId
    const isListOwnerOrAdmin = task.lists.some(
      list => canUserManageList({ id: auth.userId }, list as never)
    )

    if (!isCommentAuthor && !isTaskCreator && !isTaskAssignee && !isListOwnerOrAdmin) {
      return NextResponse.json(
        { error: 'You can only delete your own comments or comments on tasks you manage' },
        { status: 403 }
      )
    }

    await prisma.comment.delete({ where: { id } })

    trackEventFromRequest(req, auth.userId, AnalyticsEventType.COMMENT_DELETED, {
      taskId: task.id,
      commentId: id
    })

    // Broadcast SSE event for real-time updates
    try {
      const userIds = new Set<string>()

      for (const list of task.lists) {
        const listMemberIds = getListMemberIds(list as any)
        listMemberIds.forEach(userId => userIds.add(userId))
      }

      if (task.assigneeId) userIds.add(task.assigneeId)
      if (task.creatorId) userIds.add(task.creatorId)
      userIds.delete(auth.userId)

      if (userIds.size > 0) {
        broadcastToUsers(Array.from(userIds), {
          type: 'comment_deleted',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            commentId: existingComment.id,
            listNames: task.lists.map(list => list.name),
          }
        })
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to broadcast comment_deleted')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    return NextResponse.json(
      {
        success: true,
        message: 'Comment deleted successfully',
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)
