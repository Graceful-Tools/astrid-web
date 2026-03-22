/**
 * Task Comments API v1
 *
 * GET /api/v1/tasks/:id/comments - List all comments for a task
 * POST /api/v1/tasks/:id/comments - Create a new comment on a task
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'

const listSelection = {
  id: true,
  name: true,
  ownerId: true,
  privacy: true,
  publicListType: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
    },
  },
  listMembers: {
    select: {
      userId: true,
      role: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      },
    },
  },
} as const

const taskAccessInclude = {
  lists: {
    select: listSelection,
  },
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

/**
 * GET /api/v1/tasks/:id/comments
 * Get all comments for a task
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['comments:read'])

    // Verify task access - allow collaborators and all public list viewers
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

    // Fetch comments
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
    console.error('[API v1] GET /tasks/:id/comments error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/v1/tasks/:id/comments
 * Create a new comment on a task
 *
 * Body:
 * {
 *   content: string (required)
 *   type?: 'TEXT' | 'IMAGE' | 'FILE' | 'CODE' | 'AUDIO' | 'VIDEO'
 *   fileId?: string (for attaching uploaded files)
 *   parentCommentId?: string (for threaded replies)
 *   aiAgentId?: string (optional, allows posting as an AI agent - must be a valid AI agent user)
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['comments:write'])

    const { id: taskId } = await params
    const body = await req.json()

    // Validate required fields - content is required unless there's a fileId
    // This matches the internal API behavior for consistency
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

    // Verify task access and write permission (allow collaborative public list viewers)
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        ...taskAccessInclude,
        assignee: {
          select: { id: true, email: true, name: true, isAIAgent: true }
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

    // Determine the author ID - allow posting as AI agent if specified
    let authorId = auth.userId
    if (body.aiAgentId) {
      // Validate that the specified user is an AI agent
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

      if (!aiAgent.isAIAgent) {
        return NextResponse.json(
          { error: 'Invalid aiAgentId - specified user is not an AI agent' },
          { status: 400 }
        )
      }

      authorId = aiAgent.id
      console.log(`[v1 API] Posting comment as AI agent: ${aiAgent.email}`)
    }

    // Create comment
    // Accept client-provided createdAt for offline-first ordering
    // This ensures comments appear in the order the user submitted them,
    // even if uploads complete out of order
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

    // Associate secure file if provided
    if (body.fileId) {
      try {
        // Find the file — allow if user uploaded it OR if it's in a chat channel they have access to
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
            // User can link files from channels they have access to
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

        // Refetch comment to include the associated file
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
        console.error('Failed to associate file with comment:', error)
        // Don't fail the comment creation if file association fails
      }
    }

    // Broadcast SSE event for real-time updates
    try {
      const userIds = new Set<string>()

      // Get all members from all lists this task belongs to
      for (const list of task.lists) {
        const listMemberIds = getListMemberIds(list as any)
        listMemberIds.forEach(id => userIds.add(id))
      }

      // Add task assignee and creator
      if (task.assigneeId) userIds.add(task.assigneeId)
      if (task.creatorId) userIds.add(task.creatorId)

      // Remove the comment author from notifications (don't notify yourself)
      userIds.delete(authorId)

      if (userIds.size > 0) {
        // Build AgentComment-compatible object for SDK consumers
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
      console.error('[API v1] Failed to broadcast comment_created:', error)
      // Don't fail the comment creation if SSE broadcast fails
    }

    // Broadcast agent_task_comment event if task is assigned to an OpenClaw agent
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
        console.log(`[API v1] Sent agent_task_comment to OpenClaw agent ${task.assignee.email}`)
      }
    } catch (error) {
      console.error('[API v1] Failed to broadcast agent_task_comment:', error)
    }

    // Track analytics
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
    console.error('[API v1] POST /tasks/:id/comments error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
