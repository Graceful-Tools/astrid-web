/**
 * Pull request and review events → comments on the tasks they name (AWTD-1492).
 *
 * What a PR names and what each event says is pure, in
 * lib/github/webhooks/pull-requests.ts. This is the write: resolve the named
 * tasks, keep only those on a list linked to the PR's own repository, and
 * insert each comment once (remoteNodeId is unique, so a redelivered webhook is
 * a no-op). Shaped like the Projects mirror's create in github-comments.service.ts.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import {
  pullRequestEventComment,
  taskReferencesInPullRequest,
  type PullRequestShape,
  type ReviewShape,
} from '@/lib/github/webhooks/pull-requests'
import { broadcastCommentCreated, COMMENT_INCLUDE, type CommentTaskContext } from '@/services/comment.service'

const log = createLogger('github.pull-requests')

const TASK_CONTEXT_SELECT = {
  id: true,
  title: true,
  creatorId: true,
  assigneeId: true,
  lists: {
    select: { id: true, name: true, ownerId: true, githubRepositoryId: true, listMembers: { select: { userId: true } } },
  },
} as const

/** Resolve the PR's references to tasks on lists linked to this repository. */
async function tasksForPullRequest(refs: string[], repoFullName: string) {
  const ids = (await Promise.all(refs.map(ref => resolveTaskIdOrIdentifier(ref)))).filter(
    (id): id is string => Boolean(id),
  )
  if (ids.length === 0) return []
  return prisma.task.findMany({
    where: {
      id: { in: [...new Set(ids)] },
      lists: { some: { githubRepositoryId: { equals: repoFullName, mode: 'insensitive' } } },
    },
    select: TASK_CONTEXT_SELECT,
  })
}

/** The `pull_request` / `pull_request_review` webhook. Returns how many comments it wrote. */
export async function handlePullRequestTaskWebhook(
  event: string,
  payload: {
    action?: string
    pull_request?: PullRequestShape
    review?: ReviewShape
    repository?: { full_name?: string | null }
  },
): Promise<number> {
  const comment = pullRequestEventComment(event, payload)
  const pr = payload.pull_request
  const repo = payload.repository?.full_name
  if (!comment || !pr || !repo) return 0

  const refs = taskReferencesInPullRequest({ branch: pr.head?.ref, title: pr.title, body: pr.body })
  if (refs.length === 0) return 0

  const tasks = await tasksForPullRequest(refs, repo)
  let written = 0
  for (const task of tasks) {
    try {
      const created = await prisma.comment.create({
        data: {
          taskId: task.id,
          authorId: null,
          content: comment.content,
          type: 'MARKDOWN',
          remoteNodeId: `${comment.key}:${task.id}`,
          remoteAuthorLogin: comment.login,
        },
        include: COMMENT_INCLUDE,
      })
      broadcastCommentCreated(created, task as CommentTaskContext, '')
      written++
    } catch (err) {
      // Already written for this delivery (a redelivery, or two events racing).
      if ((err as { code?: string }).code === 'P2002') continue
      throw err
    }
  }
  if (written > 0) log.info({ event, action: payload.action, repo, pr: pr.number, written }, 'PR event commented on tasks')
  return written
}
