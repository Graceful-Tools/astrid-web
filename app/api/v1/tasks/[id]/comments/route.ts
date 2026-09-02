/**
 * Task Comments API v1
 *
 * GET /api/v1/tasks/:id/comments - List all comments for a task
 * POST /api/v1/tasks/:id/comments - Create a new comment on a task
 */

import { NextResponse } from 'next/server'
import {
  isV1CommentType,
  V1_COMMENT_TYPE_VALUES,
  type V1CommentCreateRequest,
} from '@/lib/api-contracts/v1-request-shapes'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { dispatchPostCommentSideEffects } from '@/lib/comments/post-comment-side-effects'
import { withAuth } from '@/lib/api-auth-wrapper'
import { agentEmail, isBrandAgentEmail, isOpenClawAgentEmail } from '@/lib/brand/agent-emails'
import { createLogger } from '@/lib/logger'
import {
  associateFileWithComment,
  createCommentIdempotently,
} from '@/lib/comments/create-comment'
import { userCanAccessTask } from "@/services/task.service"
import { TASK_COMMENTS_LIST_LIMIT } from "@/lib/task-query-utils"

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

/**
 * The shared rule — services/task.service.ts (task 017a569a, slice 4).
 *
 * Kept as a named local wrapper rather than inlining the call at both sites,
 * because the name is what makes the two conditions below readable:
 * `hasStandardAccess && !isPublicTask` says more than the predicate would.
 *
 * The null guard stays here. userCanAccessTask takes a task, and this route
 * reaches its call sites with one already checked for existence; keeping the
 * `!task` case local means the shared predicate does not have to pretend a
 * missing task is an access question.
 *
 * PUBLIC-list handling deliberately does NOT move into the service — see
 * taskIsInPublicList below. The caller decides whether public access applies;
 * the service only answers membership.
 */
function userHasStandardTaskAccess(task: any, userId: string): boolean {
  if (!task) return false
  return userCanAccessTask(task, userId)
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

    // Bounded: newest TASK_COMMENTS_LIST_LIMIT, fetched newest-first and
    // flipped back to the ascending order every client expects. An unbounded
    // listing of a runaway task (136k comments) exceeded Vercel's response cap
    // and answered an HTML 500 that no handler of ours ever saw.
    const newestFirst = await prisma.comment.findMany({
      where: { taskId },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true, isAIAgent: true }
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
      orderBy: { createdAt: 'desc' },
      take: TASK_COMMENTS_LIST_LIMIT,
    })
    const comments = [...newestFirst].reverse()

    // A short page IS the whole collection; only a full page is worth the
    // count query that tells the client how much it did not get.
    const total = newestFirst.length < TASK_COMMENTS_LIST_LIMIT
      ? newestFirst.length
      : await prisma.comment.count({ where: { taskId } })
    const truncated = total > comments.length

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        comments,
        meta: {
          total,
          truncated,
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
    const body: V1CommentCreateRequest = await req.json()

    // NOTE (task 87e19910): this route is STRICTER than its two siblings.
    // Legacy POST /api/tasks/:id/comments and POST /api/v1/chat/.../messages
    // both accept an attachment-only body with `content` absent; only this
    // one demands the key be present and a string, so `{ fileId }` alone 400s
    // here and succeeds there.
    //
    // Deliberately left as-is rather than aligned. No client trips it: iOS
    // types `content` as a non-optional String in CreateCommentOutboxPayload
    // and always sends it, empty string included. Relaxing validation with no
    // caller asking is a behaviour change bought for nothing — but the
    // divergence is worth a name, because the next person to read the
    // interface will assume all three agree.
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

    if (body.aiAgentId !== undefined && auth.source === 'legacy_mcp') {
      return NextResponse.json(
        { error: 'aiAgentId cannot be selected by the caller; use an agent-bound credential' },
        { status: 400 }
      )
    }

    // `type` lands in a Postgres enum column. Unvalidated, an unknown label
    // reached the Prisma driver and surfaced as a 500 — the caller deserves a
    // 400 that names the accepted values, and the enum is case-sensitive, so
    // "text" fails exactly like a typo. Second instance of this shape after
    // POST /api/v1/lists `privacy`. (Task 87e19910.)
    if (body.type !== undefined && !isV1CommentType(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${V1_COMMENT_TYPE_VALUES.join(', ')}` },
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

    let authorId = auth.agentUser?.id || auth.userId
    if (auth.agentUser) {
      log.info({ agentEmail: auth.agentUser.email }, 'Posting comment as authenticated AI agent')
    } else if (body.aiAgentId) {
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

      if (!aiAgent.isAIAgent && !isBrandAgentEmail(aiAgent.email)) {
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

    // ── Idempotency: clientRequestId-based (offline retry safety) ─────────
    // Mirrors the pattern in /api/v1/tasks POST. Required because iOS replays
    // queued comment creates after a network reconnect; without this, every
    // retry produces a fresh row.
    const commentInclude = {
      author: { select: { id: true, name: true, email: true, image: true, isAIAgent: true } },
      secureFiles: {
        select: { id: true, originalName: true, mimeType: true, fileSize: true, createdAt: true },
      },
    } as const

    const creation = await createCommentIdempotently({
      taskId,
      authorId,
      clientRequestId: body.clientRequestId,
      data: {
        content: body.content?.trim() || '',
        type: body.type || 'TEXT',
        parentCommentId: body.parentCommentId || null,
        ...(createdAt && !isNaN(createdAt.getTime()) && { createdAt }),
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
      const headers: Record<string, string> = {}
      const deprecationWarning = getDeprecationWarning(auth)
      if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning
      return NextResponse.json(
        {
          comment: creation.comment,
          meta: { apiVersion: 'v1', authSource: auth.source, idempotent: true },
        },
        { status: 200, headers },
      )
    }
    let comment = creation.comment

    if (body.fileId) {
      try {
        const updatedComment = await associateFileWithComment({
          fileId: body.fileId,
          commentId: comment.id,
          include: commentInclude,
          canLink: async file => {
            if (file.uploadedBy === auth.userId) return true
            if (file.chatMessage?.channelId) {
              const { canAccessChatChannel } = await import('@/lib/chat-access')
              return canAccessChatChannel(file.chatMessage.channelId, auth.userId)
            }
            return false
          },
        })

        if (updatedComment) {
          comment = updatedComment
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
          // Web client appends comment from this payload without re-fetching;
          // include attachments so offline-synced photo comments render.
          type: (comment as any).type,
          author: comment.author,
          parentCommentId: (comment as any).parentCommentId ?? null,
          secureFiles: (comment as any).secureFiles ?? []
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
          (isOpenClawAgentEmail(task.assignee.email) || task.assignee.email === agentEmail('openclaw')) &&
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
        where: { id: authorId },
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
