/**
 * Comments made on github.com → the mirrored task (AWTD-1283). The rules are
 * lib/github/projects/comments.ts; this reads GitHub and the database, and
 * applies the plan.
 *
 * A mirrored comment is stored directly, not through the create verb: that verb
 * would queue the push back to GitHub (an echo of an echo) and fire an
 * @-mention push for words written somewhere else. Clients still hear of it —
 * edits and deletions go through the comment service's own verbs.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import {
  ADOPT_WINDOW_MS,
  REMOTE_COMMENT_QUERY,
  parseRemoteComment,
  planInboundComment,
  type InboundCommentPlan,
} from '@/lib/github/projects/comments'
import {
  COMMENT_INCLUDE,
  broadcastCommentCreated,
  deleteCommentWithSideEffects,
  updateCommentWithSideEffects,
  type CommentTaskContext,
} from '@/services/comment.service'

const log = createLogger('services.github-comments')

/** What the comment service's fan-out needs to know about the task. */
const TASK_CONTEXT_SELECT = {
  id: true,
  title: true,
  creatorId: true,
  assigneeId: true,
  lists: { select: { id: true, name: true, ownerId: true, listMembers: { select: { userId: true } } } },
} as const

/** Who a change made on GitHub is attributed to when nobody in Astrid made it. */
const GITHUB_ACTOR = { id: '', name: 'GitHub' }

/** Make the task's copy of one GitHub comment match GitHub. Safe to run twice. */
export async function syncRemoteComment(
  commentNodeId: string,
  client: GraphqlClient,
  now = new Date(),
): Promise<InboundCommentPlan['kind']> {
  const remote = parseRemoteComment(await client.query(REMOTE_COMMENT_QUERY, { id: commentNodeId }))
  const mirrored = await prisma.comment.findUnique({
    where: { remoteNodeId: commentNodeId },
    select: { id: true, content: true, taskId: true },
  })

  if (!remote && !mirrored) return 'none' // a deletion of something never mirrored

  const task = await prisma.task.findUnique({
    where: remote ? { remoteNodeId: remote.subjectNodeId } : { id: mirrored!.taskId },
    select: TASK_CONTEXT_SELECT,
  })
  if (!task) return 'none' // an issue no board mirrors

  const author = remote?.authorNodeId
    ? await prisma.user.findUnique({ where: { githubNodeId: remote.authorNodeId }, select: { id: true } })
    : null
  const candidates =
    remote && !mirrored && author
      ? await prisma.comment.findMany({
          where: {
            taskId: task.id,
            authorId: author.id,
            remoteNodeId: null,
            createdAt: { gte: new Date(now.getTime() - ADOPT_WINDOW_MS) },
          },
          select: { id: true, authorId: true, content: true, createdAt: true },
        })
      : []

  const plan = planInboundComment({ remote, mirrored, authorId: author?.id ?? null, candidates, now })
  const context = task as CommentTaskContext

  switch (plan.kind) {
    case 'none':
      return 'none'
    case 'adopt':
      await prisma.comment.update({ where: { id: plan.commentId }, data: { remoteNodeId: commentNodeId } })
      return 'adopt'
    case 'update':
      await updateCommentWithSideEffects({
        commentId: plan.commentId,
        content: plan.content,
        task: context,
        editor: GITHUB_ACTOR,
      })
      return 'update'
    case 'delete':
      await deleteCommentWithSideEffects({ commentId: plan.commentId, task: context, actor: GITHUB_ACTOR })
      return 'delete'
    case 'create': {
      let comment
      try {
        comment = await prisma.comment.create({
          data: {
            taskId: task.id,
            authorId: plan.authorId,
            content: plan.content,
            // GitHub's comments are markdown.
            type: 'MARKDOWN',
            remoteNodeId: commentNodeId,
            remoteAuthorLogin: plan.remoteAuthorLogin,
            createdAt: plan.createdAt,
          },
          include: COMMENT_INCLUDE,
        })
      } catch (err) {
        // Another job mirrored it first: that one told the clients.
        if ((err as { code?: string }).code === 'P2002') return 'none'
        throw err
      }
      broadcastCommentCreated(comment, context, plan.authorId ?? GITHUB_ACTOR.id)
      log.info({ taskId: task.id, commentNodeId, mapped: Boolean(plan.authorId) }, 'GitHub comment mirrored')
      return 'create'
    }
  }
}
