/**
 * The v1 task wire shape — what `GET /api/v1/tasks/:id` returns under `task`.
 *
 * One definition, used by that route and by the live task events (AWTD-1040).
 * The events used to carry only the lean agent projection, so astrid-core
 * (iOS, Mac, Windows) followed every task event with this GET: one extra
 * request per event, per connected client. Carrying the same shape on the
 * event lets the client apply it and skip the fetch — which is only safe if
 * the two are the same shape by construction, not by two includes kept in step.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { V1TaskBlockerIds } from '@/lib/api-contracts/v1-ios-shapes'
import { TASK_COMMENTS_RESPONSE_LIMIT } from '@/lib/task-query-utils'
import { createLogger } from '@/lib/logger'
import { assigneeIdsOf } from '@/lib/task-assignees'

const log = createLogger('tasks.v1-task-shape')

export const V1_TASK_READ_INCLUDE = {
  lists: {
    select: {
      id: true,
      name: true,
      color: true,
      privacy: true,
      githubRepositoryId: true,
      aiAgentConfiguredBy: true,
      listMembers: {
        select: {
          id: true,
          listId: true,
          userId: true,
          role: true,
        },
      },
    },
  },
  assignee: {
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      isAIAgent: true,
      aiAgentType: true,
    },
  },
  creator: {
    select: { id: true, name: true, email: true, image: true },
  },
  comments: {
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          isAIAgent: true,
        },
      },
      secureFiles: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: TASK_COMMENTS_RESPONSE_LIMIT,
  },
  attachments: true,
  // Legacy's TASK_FULL_INCLUDE carries these; v1 did not, and web reads
  // them (taskLevelAttachments / CommentSection). A response that drops
  // them does not render fewer attachments — it renders none. (641a7615)
  secureFiles: true,
  // Blocking dependencies as plain id arrays (AWTD-1002). Ids only: the
  // full shapes, with the permission filtering a title needs, are
  // /api/v1/tasks/:id/blockers. A client that has never heard of these
  // fields is unaffected, which is what lets the halves ship apart.
  blockedBy: { select: { blockingTaskId: true } },
  blocks: { select: { blockedTaskId: true } },
} as const

/**
 * The v1 task for `taskId`, or null if it no longer exists. No access check:
 * the GET route checks the caller first, and an event is only given this shape
 * for recipients who can see the task.
 */
export async function loadV1Task(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: V1_TASK_READ_INCLUDE,
  })
  return task ? shapeV1Task(task) : null
}

type V1TaskRow = Prisma.TaskGetPayload<{ include: typeof V1_TASK_READ_INCLUDE }>

function shapeV1Task(task: V1TaskRow) {
  return {
    ...task,
    // Query is newest-first so the cap keeps recent comments; the wire order
    // stays ascending, which is what clients always received (task a86b5bed).
    // Copied, not reversed in place: the row may be shared with the caller.
    comments: task.comments ? [...task.comments].reverse() : task.comments,
    // iOS expects a flat listIds array alongside the relation
    listIds: task.lists?.map(list => list.id) || [],
    // Everyone assigned, `assigneeId` first (AWTD-1190).
    assigneeIds: assigneeIdsOf(task),
    ...({
      blockedBy: task.blockedBy?.map(row => row.blockingTaskId) ?? [],
      blocks: task.blocks?.map(row => row.blockedTaskId) ?? [],
    } satisfies V1TaskBlockerIds),
  }
}

export type V1Task = NonNullable<Awaited<ReturnType<typeof loadV1Task>>>

/**
 * The full v1 task for a task event, or undefined. Undefined means the event
 * goes out lean and the client fetches, exactly as before AWTD-1040 — a failed
 * read must never cost the event itself.
 */
export async function loadV1TaskForEvent(taskId: string): Promise<V1Task | undefined> {
  try {
    return (await loadV1Task(taskId)) ?? undefined
  } catch (err) {
    log.error({ err }, 'Failed to load the v1 task for a task event')
    return undefined
  }
}

/**
 * The same, for a batch of tasks in one query (AWTD-1124). A task missing from
 * the map goes out lean, and a failed read sends them all lean.
 */
export async function loadV1TasksForEvent(taskIds: string[]): Promise<Map<string, V1Task>> {
  if (taskIds.length === 0) return new Map()
  try {
    const rows = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: V1_TASK_READ_INCLUDE,
    })
    return new Map(rows.map(row => [row.id, shapeV1Task(row)]))
  } catch (err) {
    log.error({ err }, 'Failed to load the v1 tasks for task events')
    return new Map()
  }
}
