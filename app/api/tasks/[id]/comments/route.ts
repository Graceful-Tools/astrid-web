import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { CreateCommentData } from "@/types/api"
import { hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"
import { broadcastCommentCreatedNotification, broadcastToUsers } from "@/lib/sse-utils"
import { dispatchPostCommentSideEffects } from "@/lib/comments/post-comment-side-effects"
import { createLogger } from '@/lib/logger'

const log = createLogger('tasks.[id].comments')


// Helper function to safely check list access with any list-like object
function canAccessList(list: any, userId: string): boolean {
  // hasListAccess covers owner/admin/member on every payload shape; the old
  // try/catch fallback was unreachable (it returns false, never throws).
  return hasListAccess(list as any, userId)
}

export async function GET(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: taskId } = await context.params

    // Check if user has access to this task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            },
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Check if user has access to view comments on this task
    const hasAccess =
      task.assigneeId === session.user.id ||
      task.creatorId === session.user.id ||
      task.lists.some((list: any) => canAccessList(list, session.user.id)) ||
      // Allow viewing comments on public lists (both copy-only and collaborative)
      task.lists.some((list: any) => list.privacy === 'PUBLIC')

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const comments = await prisma.comment.findMany({
      where: {
        taskId,
        parentCommentId: null // Only get top-level comments
      },
      include: {
        author: true,
        secureFiles: true,
        replies: {
          include: {
            author: true,
            secureFiles: true,
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 50,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    })

    return NextResponse.json(comments)
  } catch (error) {
    log.error({ err: error }, "Error fetching comments:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data: CreateCommentData = await request.json()
    const { id: taskId } = await context.params

    // Validate required fields - content is required unless there's a fileId
    if (!data.content?.trim() && !data.fileId) {
      return NextResponse.json({ error: "Content or file attachment is required" }, { status: 400 })
    }

    // Check if user has access to this task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: true, // Include assignee for AI agent checks
        lists: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            },
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Check if user has access to comment on this task
    const hasAccess =
      task.assigneeId === session.user.id ||
      task.creatorId === session.user.id ||
      task.lists.some((list: any) => canAccessList(list, session.user.id)) ||
      // Allow comments on collaborative public lists
      task.lists.some((list: any) => list.privacy === 'PUBLIC' && list.publicListType === 'collaborative')

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Debug: Log permission check details for POST
    log.info({
      taskId: task.id,
      userId: session.user.id,
      isAssignee: task.assigneeId === session.user.id,
      isCreator: task.creatorId === session.user.id,
      listCount: task.lists.length,
      listIds: task.lists.map(l => l.id)
    }, '🔍 Comment permission check POST:')

    // Check each list's access individually for debugging
    task.lists.forEach((list, index) => {
      const listAccess = canAccessList(list, session.user.id)
      log.info({
        index,
        listId: list.id,
        access: listAccess,
        isOwner: list.ownerId === session.user.id,
        listMemberCount: list.listMembers?.length || 0,
      }, '🔍 List access')
    })

    // ── Idempotency: clientRequestId-based (offline retry safety) ─────────
    // Mirrors /api/v1/tasks/[id]/comments POST. Required because iOS replays
    // queued comment creates after a network reconnect; without this, every
    // retry produces a fresh row.
    const commentInclude = {
      author: true,
      secureFiles: true,
      replies: {
        include: { author: true, secureFiles: true },
        orderBy: { createdAt: "asc" as const },
      },
    }

    const rawClientRequestId = typeof (data as any).clientRequestId === 'string'
      ? (data as any).clientRequestId.trim()
      : null
    if (rawClientRequestId !== null && (rawClientRequestId.length < 8 || rawClientRequestId.length > 128)) {
      return NextResponse.json(
        { error: 'clientRequestId must be between 8 and 128 characters' },
        { status: 400 }
      )
    }

    if (rawClientRequestId) {
      const existing = await prisma.comment.findUnique({
        where: { clientRequestId: rawClientRequestId },
        include: commentInclude,
      })
      if (existing && existing.taskId === taskId && existing.authorId === session.user.id) {
        log.info({ commentId: existing.id }, 'Idempotency hit (clientRequestId): returning existing comment')
        return NextResponse.json(existing, { status: 200 })
      }
    }

    let comment
    try {
      // Create the comment
      comment = await prisma.comment.create({
        data: {
          content: data.content.trim() || '',
          type: data.type || "TEXT",
          parentCommentId: data.parentCommentId,
          authorId: session.user.id,
          taskId,
          clientRequestId: rawClientRequestId,
        },
        include: commentInclude,
      })
    } catch (err) {
      if (rawClientRequestId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raceExisting = await prisma.comment.findUnique({
          where: { clientRequestId: rawClientRequestId },
          include: commentInclude,
        })
        if (raceExisting && raceExisting.taskId === taskId && raceExisting.authorId === session.user.id) {
          log.info({ commentId: raceExisting.id }, 'Idempotency hit (P2002 fallback): returning existing comment')
          return NextResponse.json(raceExisting, { status: 200 })
        }
        return NextResponse.json(
          { error: 'clientRequestId already used by another request' },
          { status: 409 }
        )
      }
      throw err
    }

    // Associate secure file if provided
    if (data.fileId) {
      try {
        await prisma.secureFile.update({
          where: {
            id: data.fileId,
            uploadedBy: session.user.id // Security: only allow linking files uploaded by the user
          },
          data: {
            commentId: comment.id
          }
        })

        // Refetch the comment to include the associated file
        const updatedComment = await prisma.comment.findUnique({
          where: { id: comment.id },
          include: {
            author: true,
            secureFiles: true,
            replies: {
              include: {
                author: true,
                secureFiles: true,
              },
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        })

        // Update the comment variable to include the secure file
        if (updatedComment) {
          Object.assign(comment, updatedComment)
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to associate file with comment:')
        // Don't fail the comment creation if file association fails
      }
    }

    // Broadcast SSE updates to relevant users (route-specific: this also pings
    // OpenClaw agents on assigned tasks).
    try {
      await broadcastCommentCreatedNotification(task, comment, session.user.id)

      if (task.assigneeId && task.assignee?.email &&
          (task.assignee.email.match(/\.oc@astrid\.cc$/i) || task.assignee.email === 'openclaw@astrid.cc') &&
          session.user.id !== task.assigneeId) {
        broadcastToUsers([task.assigneeId], {
          type: 'agent_task_comment',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            comment: {
              id: comment.id,
              content: comment.content,
              authorName: (comment as any).author?.name || (comment as any).author?.email || null,
              authorId: comment.authorId,
              isAgent: false,
              createdAt: new Date(comment.createdAt).toISOString(),
            }
          }
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, "Failed to broadcast comment SSE:")
    }

    // Shared post-comment side effects: stats invalidation, @-mention push +
    // AI agent triggering, workflow command detection, AI assignee wake-up.
    // Identical logic runs from /api/v1/tasks/[id]/comments — keep them in sync
    // by editing lib/comments/post-comment-side-effects.ts.
    try {
      const commenterUser = await prisma.user.findUnique({
        where: { id: session.user.id },
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
            lists: task.lists.map((l: any) => ({
              id: l.id,
              githubRepositoryId: l.githubRepositoryId ?? null,
              aiAgentConfiguredBy: l.aiAgentConfiguredBy ?? null,
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
      log.error({ err: sideEffectError }, "post-comment side effects failed:")
    }

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.COMMENT_ADDED, {
      commentId: comment.id,
      taskId
    })

    return NextResponse.json(comment)
  } catch (error) {
    log.error({ err: error }, "Error creating comment:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
