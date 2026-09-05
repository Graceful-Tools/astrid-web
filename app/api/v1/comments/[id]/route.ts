/**
 * Individual Comment API v1
 *
 * GET /api/v1/comments/:id - Get a single comment
 * PUT /api/v1/comments/:id - Update a comment
 * DELETE /api/v1/comments/:id - Delete a comment
 */

import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import {
  routeIdParamsSchema,
  v1CommentUpdateRequestSchema,
} from '@/lib/api-contracts/shared-schemas'
import { parseJsonBody, parseRouteParams } from '@/lib/api-validation'
import type { V1ResponseMeta } from '@/lib/api-contracts/v1-ios-shapes'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { userCanAccessTask } from "@/services/task.service"
import { canDeleteComment, commentAudience } from "@/lib/comment-permissions"
import { reconcileTaskLifecycleAfterMutation } from '@/lib/agent-lifecycle-mutations'

const log = createLogger('v1.comments.id')

type RouteContext = { params: Promise<{ id: string }> }

const COMMENT_UPDATE_INCLUDE = {
  author: {
    select: { id: true, name: true, email: true, image: true },
  },
  secureFiles: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CommentInclude

type CommentMutationDto = Prisma.CommentGetPayload<{
  include: typeof COMMENT_UPDATE_INCLUDE
}>

interface V1CommentMutationResponse {
  comment: CommentMutationDto
  meta: V1ResponseMeta
}

/**
 * GET /api/v1/comments/:id
 * Get a single comment by ID
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['comments:read'], tag: 'v1.comments.id' },
  async (_req, auth, { params }) => {
    const parsedParams = await parseRouteParams(params, routeIdParamsSchema)
    if (!parsedParams.ok) return parsedParams.response
    const { id } = parsedParams.data

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

    // Verify user has access to the task — the shared rule,
    // services/task.service.ts (task 017a569a, slice 5). Fifth copy of this
    // three-way check to be folded in, and the only one that was fully inline
    // rather than behind a local helper.
    //
    // NOTE for anyone tightening this later: the fetch above selects
    // listMembers WITHOUT `role`. That is sufficient for an ACCESS check,
    // which only asks whether a membership exists. It would NOT be sufficient
    // for a manage-level check — getUserRoleInList reads `role` to distinguish
    // admin, so with it unselected every admin resolves as a plain member and
    // canUserManageList would deny them. Select `role` before changing this to
    // a management gate.
    const hasAccess = userCanAccessTask(comment.task, auth.userId)

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
    const parsedParams = await parseRouteParams(params, routeIdParamsSchema)
    if (!parsedParams.ok) return parsedParams.response
    const { id } = parsedParams.data
    const parsedBody = await parseJsonBody(req, v1CommentUpdateRequestSchema)
    if (!parsedBody.ok) return parsedBody.response
    const { content } = parsedBody.data

    // The task and its lists come along because the broadcast below needs the
    // audience — everyone who can see this comment.
    const existingComment = await prisma.comment.findUnique({
      where: { id },
      select: {
        authorId: true,
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
                listMembers: { select: { userId: true } },
              },
            },
          },
        },
      },
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
      data: { content, updatedAt: new Date() },
      include: COMMENT_UPDATE_INCLUDE,
    })
    await reconcileTaskLifecycleAfterMutation(comment.taskId)

    // Tell everyone looking at this task. Without it, an edit made from iOS left
    // every open web client showing the old text until it refetched — the
    // legacy PUT has always broadcast this. (Task 130508e3.)
    //
    // The editor stays IN the audience on purpose: components/task-detail.tsx
    // filters on data.userId itself. That is the opposite of DELETE below,
    // which drops the actor server-side.
    try {
      const task = existingComment.task
      const userIds = commentAudience(task)

      if (userIds.size > 0) {
        broadcastToUsers(Array.from(userIds), {
          type: 'comment_updated',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            commentId: comment.id,
            commentContent: comment.content.substring(0, 100),
            editorName: auth.user?.name || auth.user?.email || 'Someone',
            userId: auth.userId,
            listNames: task.lists.map(list => list.name),
            comment: {
              id: comment.id,
              content: comment.content,
              type: comment.type,
              author: comment.author,
              createdAt: comment.createdAt,
              updatedAt: comment.updatedAt,
              parentCommentId: comment.parentCommentId,
            },
          },
        })
      }
    } catch (sseError) {
      // Best-effort: the edit is already committed.
      log.error({ err: sseError }, 'Failed to broadcast comment_updated')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    const responseBody = {
      comment,
      meta: { apiVersion: 'v1', authSource: auth.source },
    } satisfies V1CommentMutationResponse

    return NextResponse.json(
      responseBody,
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
    const parsedParams = await parseRouteParams(params, routeIdParamsSchema)
    if (!parsedParams.ok) return parsedParams.response
    const { id } = parsedParams.data

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

    // Author, the people responsible for the task, or a list admin.
    if (!canDeleteComment(existingComment.authorId, task, auth.userId)) {
      return NextResponse.json(
        { error: 'You can only delete your own comments or comments on tasks you manage' },
        { status: 403 }
      )
    }

    await prisma.comment.delete({ where: { id } })
    await reconcileTaskLifecycleAfterMutation(task.id)

    trackEventFromRequest(req, auth.userId, AnalyticsEventType.COMMENT_DELETED, {
      taskId: task.id,
      commentId: id
    })

    // Broadcast SSE event for real-time updates
    try {
      const userIds = commentAudience(task)
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
