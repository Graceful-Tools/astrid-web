/**
 * Task Comments API v1
 *
 * GET /api/v1/tasks/:id/comments - List all comments for a task
 * POST /api/v1/tasks/:id/comments - Create a new comment on a task
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { dispatchPostCommentSideEffects } from '@/lib/comments/post-comment-side-effects'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.comments')

const listSelection = {
  id: true,
  name: true,
  ownerId: true,
  privacy: true,
  publicListType: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: { id: true, email: true, name: true, image: true },
  },
  listMembers: {
    select: {
      userId: true,
      role: true,
      user: { select: { id: true, email: true, name: true, image: true } },
    },
  },
} as const

const taskAccessInclude = {
  lists: { select: listSelection },
} as const

function userHasStandardTaskAccess(task: any, userId: string): boolean {
  if (!task) return false

  if (task.creatorId === userId || task.assigneeId === userId) {
    return true
  }

  return (task.lists || []).some((list: any) => {
    if (list.ownerId === userId) return true
    return list.listMembers?.some((member: any) => member.userId === userId)
  })
}

function taskIsInPublicList(task: any): boolean {
  return (task.lists || []).some((list: any) => list.privacy === 'PUBLIC')
}

function taskIsInCollaborativePublicList(task: any): boolean {
  return (task.lists || []).some(
    (list: any) => list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'
  )
}

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/tasks/:id/comments
 * Get all comments for a task
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['comments:read'], tag: 'v1.tasks.comments' },
  async (_req, auth, { params }) => {
    const { id: taskId } = await params

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: taskAccessInclude,
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const hasStandardAccess = userHasStandardTaskAccess(task, auth.userId)
    const isPublicTask = taskIsInPublicList(task)

    if (!hasStandardAccess && !isPublicTask) {
      return NextResponse.json(
        { error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const comments = await prisma.comment.findMany({
      where: { taskId },
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
      },
      orderBy: { createdAt: 'asc' }
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        comments,
        meta: {
          total: comments.length,
          taskId,
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)

/**
 * POST /api/v1/tasks/:id/comments
 * Create a new comment on a task
 *
 * Body: { content, type?, fileId?, parentCommentId?, aiAgentId?, createdAt? }
 */
export const POST = withAuth<RouteContext>(
  { scopes: ['comments:write'], tag: 'v1.tasks.comments' },
  async (req, auth, { params }) => {
    const { id: taskId } = await params
    const body = await req.json()

    // content must be a string; trim+fileId together cover the no-content case
    if (typeof body.content !== 'string') {
      return NextResponse.json(
        { error: 'content must be a string' },
        { status: 400 }
      )
    }

    if (!body.content?.trim() && !body.fileId) {
      return NextResponse.json(
        { error: 'Content or file attachment is required' },
        { status: 400 }
      )
    }

    // Extra fields beyond standard taskAccessInclude — needed by the post-comment
    // side-effects helper to route AI agent triggers and workflow detection.
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: {
          select: {
            ...listSelection,
            githubRepositoryId: true,
            aiAgentConfiguredBy: true,
          },
        },
        assignee: {
          select: { id: true, email: true, name: true, isAIAgent: true, aiAgentType: true }
        },
      },
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const hasStandardAccess = userHasStandardTaskAccess(task, auth.userId)
    const isCollaborativePublic = taskIsInCollaborativePublicList(task)

    if (!hasStandardAccess && !isCollaborativePublic) {
      return NextResponse.json(
        { error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    let authorId = auth.userId
    if (body.aiAgentId) {
      const aiAgent = await prisma.user.findUnique({
        where: { id: body.aiAgentId },
        select: { id: true, isAIAgent: true, email: true }
      })

      if (!aiAgent) {
        return NextResponse.json(
          { error: 'Invalid aiAgentId - user not found' },
          { status: 400 }
        )
      }

      // Allow either explicitly-flagged AI agents or system @astrid.cc agents
      const isSystemAgent = aiAgent.email?.endsWith('@astrid.cc')
      if (!aiAgent.isAIAgent && !isSystemAgent) {
        return NextResponse.json(
          { error: 'Invalid aiAgentId - specified user is not an AI agent' },
          { status: 400 }
        )
      }

      authorId = aiAgent.id
      log.info({ agentEmail: aiAgent.email }, 'Posting comment as AI agent')
    }

    // Accept client-provided createdAt for offline-first ordering — comments
    // appear in the order the user submitted, even if uploads finish out of order.
    const createdAt = body.createdAt ? new Date(body.createdAt) : undefined

    const comment = await prisma.comment.create({
      data: {
        content: body.content?.trim() || '',
        type: body.type || 'TEXT',
        authorId,
        taskId,
        parentCommentId: body.parentCommentId || null,
        ...(createdAt && !isNaN(createdAt.getTime()) && { createdAt })
      },
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

    if (body.fileId) {
      try {
        // Allow linking a file the user uploaded OR one in a chat channel they can read
        const secureFile = await prisma.secureFile.findUnique({
          where: { id: body.fileId },
          select: {
            id: true,
            uploadedBy: true,
            chatMessageId: true,
            chatMessage: { select: { channelId: true } },
          },
        })

        let canLink = false
        if (secureFile) {
          if (secureFile.uploadedBy === auth.userId) {
            canLink = true
          } else if (secureFile.chatMessage?.channelId) {
            const { canAccessChatChannel } = await import('@/lib/chat-access')
            canLink = await canAccessChatChannel(secureFile.chatMessage.channelId, auth.userId)
          }
        }

        if (canLink) {
          await prisma.secureFile.update({
            where: { id: body.fileId },
            data: { commentId: comment.id },
          })
        }

        const updatedComment = await prisma.comment.findUnique({
          where: { id: comment.id },
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
          },
        })

        if (updatedComment) {
          Object.assign(comment, updatedComment)
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to associate file with comment')
      }
    }

    try {
      const userIds = new Set<string>()

      for (const list of task.lists) {
        const listMemberIds = getListMemberIds(list as any)
        listMemberIds.forEach(id => userIds.add(id))
      }

      if (task.assigneeId) userIds.add(task.assigneeId)
      if (task.creatorId) userIds.add(task.creatorId)

      // Don't notify the comment author about their own comment
      userIds.delete(authorId)

      if (userIds.size > 0) {
        // AgentComment-shaped object for SDK consumers
        const agentComment = {
          id: comment.id,
          content: comment.content,
          authorName: comment.author?.name || comment.author?.email || null,
          authorId: comment.authorId,
          isAgent: comment.author ? !!(comment.author as any).isAIAgent : false,
          createdAt: new Date(comment.createdAt).toISOString(),
        }
        broadcastToUsers(Array.from(userIds), {
          type: 'comment_created',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            commentId: comment.id,
            listNames: task.lists.map(l => l.name),
            comment: agentComment
          }
        })
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to broadcast comment_created')
    }

    // Direct ping to OpenClaw assignees so the agent picks the work up
    // without having to subscribe to the broader comment_created channel.
    try {
      if (task.assigneeId && task.assignee?.email &&
          (task.assignee.email.match(/\.oc@astrid\.cc$/i) || task.assignee.email === 'openclaw@astrid.cc') &&
          authorId !== task.assigneeId) {
        broadcastToUsers([task.assigneeId], {
          type: 'agent_task_comment',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            comment: {
              id: comment.id,
              content: comment.content,
              authorName: comment.author?.name || comment.author?.email || null,
              authorId: comment.authorId,
              isAgent: false,
              createdAt: new Date(comment.createdAt).toISOString(),
            }
          }
        })
        log.info({ agentEmail: task.assignee.email }, 'Sent agent_task_comment to OpenClaw agent')
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to broadcast agent_task_comment')
    }

    // Shared with /api/tasks/[id]/comments: AI mention triggers, workflow command
    // detection, AI assignee wake-up, and stats invalidation.
    try {
      const commenterUser = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, isAIAgent: true },
      })
      if (commenterUser) {
        await dispatchPostCommentSideEffects({
          comment: { id: comment.id, content: comment.content },
          task: {
            id: task.id,
            title: task.title,
            creatorId: task.creatorId,
            assigneeId: task.assigneeId,
            assignee: task.assignee
              ? {
                  id: task.assignee.id,
                  email: task.assignee.email,
                  name: task.assignee.name,
                  isAIAgent: task.assignee.isAIAgent,
                  aiAgentType: (task.assignee as any).aiAgentType ?? null,
                }
              : null,
            lists: task.lists.map(l => ({
              id: l.id,
              githubRepositoryId: (l as any).githubRepositoryId ?? null,
              aiAgentConfiguredBy: (l as any).aiAgentConfiguredBy ?? null,
            })),
          },
          commenter: {
            id: commenterUser.id,
            name: commenterUser.name,
            email: commenterUser.email,
            isAIAgent: commenterUser.isAIAgent,
          },
        })
      }
    } catch (sideEffectError) {
      log.error({ err: sideEffectError }, 'post-comment side effects failed')
    }

    trackEventFromRequest(req, auth.userId, AnalyticsEventType.COMMENT_ADDED, {
      taskId,
      commentId: comment.id
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        comment,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { status: 201, headers }
    )
  }
)
