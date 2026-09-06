import { type NextRequest, NextResponse } from "next/server"
import { parseLimit } from '@/lib/pagination'
import { safeUserSelect } from '@/lib/user-select'

/**
 * A task's comment thread is read in one request by every client, so these are
 * about keeping one response inside the function's memory rather than about
 * paging a UI. Raised deliberately high; the point is that there IS a ceiling.
 */
const DEFAULT_COMMENT_PAGE_SIZE = 200
const MAX_COMMENT_PAGE_SIZE = 500
const MAX_REPLIES_PER_COMMENT = 50
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import type { CreateCommentData } from "@/types/api"
import { hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"
import { broadcastCommentCreatedNotification, broadcastToUsers } from "@/lib/sse-utils"
import { dispatchPostCommentSideEffects } from "@/lib/comments/post-comment-side-effects"
import { agentEmail, isOpenClawAgentEmail } from '@/lib/brand/agent-emails'
import { createLogger } from '@/lib/logger'
import {
  associateFileWithComment,
  createCommentIdempotently,
} from '@/lib/comments/create-comment'

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
            owner: { select: safeUserSelect },
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

    // Bounded, and with a user SELECT rather than the whole row.
    //
    // This was an unbounded findMany that embedded the whole author row on
    // both the comment and every reply, so a long agent thread returned
    // hundreds of full User records — each carrying email, mcpSettings,
    // webhookUrl and the email verification token. On 2026-08-29 this endpoint was killed for running
    // out of memory seven times on a single task, taking neighbouring requests
    // down with the instance (task 2e08b86d).
    const take = parseLimit(new URL(request.url).searchParams.get('limit'), {
      fallback: DEFAULT_COMMENT_PAGE_SIZE,
      max: MAX_COMMENT_PAGE_SIZE,
    })

    const comments = await prisma.comment.findMany({
      where: {
        taskId,
        parentCommentId: null // Only get top-level comments
      },
      include: {
        author: { select: safeUserSelect },
        secureFiles: true,
        replies: {
          include: {
            author: { select: safeUserSelect },
            secureFiles: true,
          },
          orderBy: {
            createdAt: "asc",
          },
          take: MAX_REPLIES_PER_COMMENT,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      take,
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
        // Only the fields the AI-agent check and the side effects use.
        assignee: {
          select: { id: true, email: true, name: true, isAIAgent: true, aiAgentType: true },
        },
        lists: {
          include: {
            owner: { select: safeUserSelect },
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

    // ── Idempotency: clientRequestId-based (offline retry safety) ─────────
    // Mirrors /api/v1/tasks/[id]/comments POST. Required because iOS replays
    // queued comment creates after a network reconnect; without this, every
    // retry produces a fresh row.
    const commentInclude = {
      author: { select: safeUserSelect },
      secureFiles: true,
      replies: {
        include: { author: { select: safeUserSelect }, secureFiles: true },
        orderBy: { createdAt: "asc" as const },
        take: MAX_REPLIES_PER_COMMENT,
      },
    } as const

    const creation = await createCommentIdempotently({
      taskId,
      authorId: session.user.id,
      clientRequestId: data.clientRequestId,
      data: {
        content: data.content.trim() || '',
        type: data.type || "TEXT",
        parentCommentId: data.parentCommentId,
      },
      include: commentInclude,
    })
    if (creation.kind === 'invalid') {
      return NextResponse.json({ error: creation.error }, { status: 400 })
    }
    if (creation.kind === 'conflict') {
      return NextResponse.json({ error: creation.error }, { status: 409 })
    }
    if (creation.kind === 'existing') {
      log.info({ commentId: creation.comment.id }, 'Idempotency hit: returning existing comment')
      return NextResponse.json(creation.comment, { status: 200 })
    }
    let comment = creation.comment

    // Associate secure file if provided
    if (data.fileId) {
      try {
        const updatedComment = await associateFileWithComment({
          fileId: data.fileId,
          commentId: comment.id,
          include: commentInclude,
          canLink: file => file.uploadedBy === session.user.id,
        })
        if (updatedComment) {
          comment = updatedComment
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
          (isOpenClawAgentEmail(task.assignee.email) || task.assignee.email === agentEmail('openclaw')) &&
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
