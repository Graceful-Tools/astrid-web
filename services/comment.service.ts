/**
 * The comment CREATE verb, in one place (epic 9dedd8aa).
 *
 * Five surfaces created comments and no two of them did the same work. The
 * columns that mattered were not style — they were guarantees that were simply
 * false depending on which door you came in through:
 *
 *   legacy app/api/tasks/[id]/comments        idempotency ✅  side effects ✅
 *   v1     app/api/v1/tasks/[id]/comments     idempotency ✅  side effects ✅
 *   MCP    mcp/handlers/comments.ts (stdio)   idempotency ❌  side effects ✅
 *   agent  app/api/v1/agent/tasks/[id]/...    idempotency ❌  side effects ❌
 *   MCP    operations/comment-operations.ts   idempotency ❌  side effects ❌
 *
 * `dispatchPostCommentSideEffects` is what sends an @-mention push, triggers
 * the mentioned AI agent, detects a workflow command (approve / ship-it /
 * changes) and invalidates stats. A surface that skipped it accepted the
 * comment, stored it, broadcast it — and then did none of the things a comment
 * is FOR. That hurt most on the MCP surface, because that is the door agents
 * come through: posting "ship it" or "@someone please look" through MCP was
 * inert. Task 390bccc3 fixed exactly this bug for the stdio MCP server, and
 * could not fix the HTTP one it did not know about. One implementation is how
 * that stops happening.
 *
 * Routes keep shaping their own RESPONSE — the wire formats genuinely differ
 * (v1 returns the Prisma row, the agent surface returns an `AgentComment`, MCP
 * returns an iOS-compatible shape) — but they no longer decide what creating a
 * comment means.
 */
import type { CommentType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { broadcastToUsers } from '@/lib/sse-utils'
import { applyCommentActorRule } from '@/lib/comment-permissions'
import { getListMemberIds } from '@/lib/list-member-utils'
import { createCommentIdempotently, associateFileWithComment } from '@/lib/comments/create-comment'
import { dispatchPostCommentSideEffects } from '@/lib/comments/post-comment-side-effects'
import { agentEmail, isOpenClawAgentEmail } from '@/lib/brand/agent-emails'

const log = createLogger('services.comment')

/**
 * The canonical shape a created comment is read back in.
 *
 * A superset of what the surfaces each used to ask for, so no caller loses a
 * field. MCP still remaps `secureFiles` to its iOS-compatible names on the way
 * out — that is a response concern, not a creation concern.
 */
export const COMMENT_INCLUDE = {
  author: { select: { id: true, name: true, email: true, image: true, isAIAgent: true } },
  secureFiles: {
    select: { id: true, originalName: true, mimeType: true, fileSize: true, createdAt: true },
  },
} as const

/**
 * What the service needs to know about the task being commented on.
 *
 * Callers fetch and access-check the task themselves — the access rules
 * genuinely differ per surface (an agent may only comment on tasks assigned to
 * it; the collaborative-public rule applies only to the human surfaces) — and
 * then normalise it to this.
 */
export interface CommentTaskContext {
  id: string
  title: string
  creatorId: string | null
  assigneeId: string | null
  assignee: {
    id?: string
    email: string | null
    name?: string | null
    isAIAgent: boolean
    aiAgentType?: string | null
  } | null
  lists: Array<{
    id: string
    name?: string | null
    ownerId?: string | null
    listMembers?: Array<{ userId: string }> | null
    githubRepositoryId?: string | null
    aiAgentConfiguredBy?: string | null
  }>
}

export interface CreateCommentArgs {
  task: CommentTaskContext
  /** The comment's AUTHOR — an agent id when an agent is speaking, never the credential owner. */
  authorId: string
  content: string
  type?: string
  parentCommentId?: string | null
  /** Offline retry safety. Absent on surfaces that do not send one. */
  clientRequestId?: unknown
  /** Client-provided ordering for offline-first submission. */
  createdAt?: Date
  /** Attachment to link, plus the user whose permission governs the link. */
  file?: { id: string; linkerUserId: string }
  /**
   * Extra ids that must receive the event beyond list members, creator and
   * assignee. The MCP surface resolves members through its own query.
   */
  additionalAudience?: string[]
  /**
   * Override the read-back shape. Defaults to COMMENT_INCLUDE; the legacy route
   * passes its own because its response embeds `replies`.
   */
  include?: Prisma.CommentInclude
}

export type CreateCommentOutcome<TComment = CreatedComment> =
  | { kind: 'created'; comment: TComment }
  | { kind: 'existing'; comment: TComment }
  | { kind: 'invalid'; error: string }
  | { kind: 'conflict'; error: string }

export type CreatedComment = Prisma.CommentGetPayload<{ include: typeof COMMENT_INCLUDE }>

/**
 * The fields the fan-out and side effects actually read.
 *
 * Callers may pass their own `include` — the legacy route embeds `replies` in
 * its response and cannot lose that shape — so the service is generic over the
 * row it reads back and only requires the columns it genuinely uses.
 */
export interface CommentForFanOut {
  id: string
  content: string
  authorId: string | null
  createdAt: Date
  type?: unknown
  parentCommentId?: string | null
  secureFiles?: unknown
  author?: { id: string; name: string | null; email: string | null; isAIAgent?: boolean } | null
}

/**
 * Create a comment and fire everything creating a comment implies.
 *
 * Returns `existing` when a `clientRequestId` replays, so callers can answer
 * 200 rather than minting a duplicate. Side effects run only for a genuinely
 * new comment — a replayed create must not send the push twice.
 */
export async function createCommentWithSideEffects<TComment = CreatedComment>(
  args: CreateCommentArgs,
): Promise<CreateCommentOutcome<TComment>> {
  const { task, authorId } = args
  const include = (args.include ?? COMMENT_INCLUDE) as typeof COMMENT_INCLUDE

  const creation = await createCommentIdempotently({
    taskId: task.id,
    authorId,
    clientRequestId: args.clientRequestId,
    data: {
      content: args.content,
      type: (args.type as CommentType) || 'TEXT',
      parentCommentId: args.parentCommentId || null,
      ...(args.createdAt && !isNaN(args.createdAt.getTime()) && { createdAt: args.createdAt }),
    },
    include,
  })

  if (creation.kind === 'invalid' || creation.kind === 'conflict') return creation
  if (creation.kind === 'existing') {
    log.info({ commentId: creation.comment.id }, 'Idempotency hit: returning existing comment')
    return creation as CreateCommentOutcome<TComment>
  }

  let comment = creation.comment

  if (args.file) {
    comment = (await linkFile(comment, args.file, include)) ?? comment
  }

  // Each of these is best-effort and independently guarded: a comment that is
  // already stored must not fail its request because a downstream fan-out did.
  broadcastCommentCreated(comment, task, authorId, args.additionalAudience)
  pingOpenClawAssignee(comment, task, authorId)
  await runSideEffects(comment, task, authorId)

  return { kind: 'created', comment } as CreateCommentOutcome<TComment>
}

async function linkFile(
  comment: CreatedComment,
  file: { id: string; linkerUserId: string },
  include: typeof COMMENT_INCLUDE,
): Promise<CreatedComment | null> {
  try {
    return await associateFileWithComment({
      fileId: file.id,
      commentId: comment.id,
      include,
      canLink: async candidate => {
        if (candidate.uploadedBy === file.linkerUserId) return true
        if (candidate.chatMessage?.channelId) {
          const { canAccessChatChannel } = await import('@/lib/chat-access')
          return canAccessChatChannel(candidate.chatMessage.channelId, file.linkerUserId)
        }
        return false
      },
    })
  } catch (err) {
    log.error({ err }, 'Failed to associate file with comment')
    return null
  }
}

/**
 * Who hears about a new comment.
 *
 * The author STAYS in: their phone, Mac and other tabs are separate SSE
 * connections under one user id, and they are the whole reason this event
 * exists. Receivers dedupe on comment id. Only an AI-agent author is dropped,
 * to stop an agent answering its own comment. (Task cb1581e0 —
 * `applyCommentActorRule` in lib/comment-permissions.ts.)
 */
function broadcastCommentCreated(
  comment: CommentForFanOut,
  task: CommentTaskContext,
  authorId: string,
  additionalAudience?: string[],
): void {
  try {
    const userIds = new Set<string>(additionalAudience ?? [])

    for (const list of task.lists) {
      for (const id of getListMemberIds(list as never)) userIds.add(id)
    }
    if (task.assigneeId) userIds.add(task.assigneeId)
    if (task.creatorId) userIds.add(task.creatorId)

    applyCommentActorRule(userIds, {
      id: authorId,
      isAIAgent: Boolean(comment.author?.isAIAgent),
    })

    if (userIds.size === 0) return

    const authorName = comment.author?.name || comment.author?.email || 'Someone'

    broadcastToUsers(Array.from(userIds), {
      type: 'comment_created',
      timestamp: new Date().toISOString(),
      data: {
        taskId: task.id,
        // The payload is the UNION of what the surfaces each used to send, so
        // unifying creation did not quietly drop a field some client reads.
        taskTitle: task.title,
        commentId: comment.id,
        commentContent: comment.content.substring(0, 100),
        commenterName: authorName,
        userId: authorId,
        listNames: task.lists.map(l => l.name).filter(Boolean),
        comment: {
          id: comment.id,
          content: comment.content,
          authorName,
          authorId: comment.authorId,
          isAgent: Boolean(comment.author?.isAIAgent),
          createdAt: new Date(comment.createdAt).toISOString(),
          type: comment.type,
          author: comment.author,
          parentCommentId: comment.parentCommentId ?? null,
          secureFiles: comment.secureFiles ?? [],
        },
      },
    })
  } catch (err) {
    log.error({ err }, 'Failed to broadcast comment_created')
  }
}

/**
 * Direct ping to an OpenClaw assignee so the agent picks the work up without
 * subscribing to the broader comment_created channel.
 */
function pingOpenClawAssignee(
  comment: CommentForFanOut,
  task: CommentTaskContext,
  authorId: string,
): void {
  try {
    const email = task.assignee?.email
    if (!task.assigneeId || !email) return
    if (!isOpenClawAgentEmail(email) && email !== agentEmail('openclaw')) return
    if (authorId === task.assigneeId) return

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
        },
      },
    })
    log.info({ agentEmail: email }, 'Sent agent_task_comment to OpenClaw agent')
  } catch (err) {
    log.error({ err }, 'Failed to broadcast agent_task_comment')
  }
}

/**
 * @-mention push and agent triggering, workflow command detection, AI assignee
 * wake-up, stats invalidation. The two surfaces that skipped this are the whole
 * reason this service exists.
 */
async function runSideEffects(
  comment: CommentForFanOut,
  task: CommentTaskContext,
  authorId: string,
): Promise<void> {
  try {
    // Always look the commenter up by authorId rather than reusing
    // `comment.author`. Callers choose their own include — the legacy route's
    // uses safeUserSelect — so the loaded author is not guaranteed to carry
    // `isAIAgent`, and getting that wrong makes an agent's comment look human
    // to the side effects. (Caught by the d9e4aae0 regression test.)
    const commenter = await prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, name: true, email: true, isAIAgent: true },
    })
    if (!commenter) return

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
              aiAgentType: task.assignee.aiAgentType ?? null,
            }
          : null,
        lists: task.lists.map(l => ({
          id: l.id,
          githubRepositoryId: l.githubRepositoryId ?? null,
          aiAgentConfiguredBy: l.aiAgentConfiguredBy ?? null,
        })),
      },
      commenter: {
        id: commenter.id,
        name: commenter.name,
        email: commenter.email,
        isAIAgent: Boolean(commenter.isAIAgent),
      },
    })
  } catch (err) {
    log.error({ err }, 'post-comment side effects failed')
  }
}
