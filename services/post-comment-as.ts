/**
 * Post a comment as an agent or the system — through the comment service.
 *
 * Agent replies, coding-workflow progress and webhook-delivered updates used to
 * be raw `prisma.comment.create` calls: no list broadcast (several not even
 * SSE), no in-app notification, no mention push. They now get exactly what a
 * person's comment gets, because they ARE created the same way. Spec:
 * docs/specs/GITHUB_PROJECTS_WHITELABEL.md §5.2 step 4.
 *
 * Agent-authored comments never re-wake agents: the post-comment side effects
 * skip agent dispatch when the commenter is an AI agent.
 */

import { prisma } from '@/lib/prisma'
import { createCommentWithSideEffects, type CreatedComment } from '@/services/comment.service'

/** What createCommentWithSideEffects reads off the task: audience and agent wake-up. */
const COMMENT_TASK_CONTEXT = {
  id: true,
  title: true,
  creatorId: true,
  assigneeId: true,
  assignee: { select: { id: true, email: true, name: true, isAIAgent: true, aiAgentType: true } },
  lists: {
    select: {
      id: true,
      name: true,
      ownerId: true,
      githubRepositoryId: true,
      aiAgentConfiguredBy: true,
      listMembers: { select: { userId: true } },
    },
  },
} as const

export interface PostCommentAsArgs {
  taskId: string
  /** The author: an agent user's id, or the user an automated note is from. */
  authorId: string
  content: string
  type?: 'TEXT' | 'MARKDOWN'
  /** A SecureFile the AUTHOR uploaded, linked before the comment is broadcast. */
  fileId?: string
}

export type PostCommentAsResult =
  | { ok: true; comment: CreatedComment }
  | { ok: false; error: string }

export async function postCommentAs(args: PostCommentAsArgs): Promise<PostCommentAsResult> {
  const task = await prisma.task.findUnique({ where: { id: args.taskId }, select: COMMENT_TASK_CONTEXT })
  if (!task) return { ok: false, error: 'Task not found' }

  const outcome = await createCommentWithSideEffects({
    task,
    authorId: args.authorId,
    content: args.content,
    type: args.type ?? 'MARKDOWN',
    ...(args.fileId && { file: { id: args.fileId, linkerUserId: args.authorId } }),
  })
  if (outcome.kind === 'invalid' || outcome.kind === 'conflict') return { ok: false, error: outcome.error }
  return { ok: true, comment: outcome.comment }
}
