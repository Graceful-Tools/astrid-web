/**
 * Who may act on a task — the access rule, and the fetch that comes with it.
 *
 * Lifted out of services/task.service.ts (which re-exports both, so every caller is unchanged)
 * to keep that file inside the oversized-files ratchet (task 9377bc2c), the way
 * task-completion.ts and task-status-role.ts were.
 */
import { prisma } from '@/lib/prisma'
import { hasExplicitListRole } from '@/lib/list-permissions'

/**
 * The relations the access rule reads. NOT exported: fetching with this shape
 * and then hand-rolling the check is exactly the mistake this module exists to
 * prevent, so the only way to get the shape is to get the check with it.
 */
const TASK_ACCESS_INCLUDE = {
  creator: true,
  assignee: true,
  lists: {
    include: {
      owner: true,
      listMembers: { include: { user: true } },
    },
  },
} as const

export type TaskAccessResult =
  | { ok: true; task: NonNullable<Awaited<ReturnType<typeof findTask>>> }
  | { ok: false; status: 404 | 403; error: string }

function findTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: TASK_ACCESS_INCLUDE,
  })
}

/**
 * Fetch a task only if `userId` may act on it.
 *
 * Access is creator, assignee, or an explicit role on any list the task is on.
 * Deliberately NOT public-list access: a PUBLIC list makes a task readable, and
 * every caller of this so far is doing something to the task rather than
 * reading it. A read path that should honour public lists needs its own
 * function rather than a boolean on this one — a flag here would let a caller
 * widen a write to public readers by passing the wrong argument.
 *
 * Returns 404 for a missing task and 403 for a forbidden one, matching what the
 * routes already returned, so adopting it does not change any response.
 */
export async function getTaskForUser(taskId: string, userId: string): Promise<TaskAccessResult> {
  const task = await findTask(taskId)

  if (!task) {
    return { ok: false, status: 404, error: 'Task not found' }
  }

  if (!userCanAccessTask(task, userId)) {
    return { ok: false, status: 403, error: 'Access denied' }
  }

  return { ok: true, task }
}

/** The minimum a task must carry for the access rule to be answerable. */
export interface TaskWithAccessRelations {
  creatorId?: string | null
  assigneeId?: string | null
  lists?: Array<{ ownerId?: string; listMembers?: unknown }> | null
}

/**
 * The access rule itself, for callers that ALREADY hold the task.
 *
 * Slice 2 (task 017a569a). Some routes reach a task as a relation of something
 * else — coding-workflow/status loads it through CodingTaskWorkflow — so
 * getTaskForUser would mean a second query for a row already in memory. They
 * were each re-spelling the three-way check instead.
 *
 * Exporting a predicate reopens the risk slice 1 closed by keeping the include
 * private: a caller can now pass a task fetched WITHOUT `lists.listMembers`,
 * and `hasExplicitListRole` would find no membership and deny a legitimate
 * member. That is the exact bug of task 73733c3d, and it is nasty because it
 * fails CLOSED — a denied member reads as a permissions quirk, not a missing
 * relation.
 *
 * So the shape is checked rather than trusted. A task whose lists were loaded
 * without their members THROWS here, loudly, at the call site that got it
 * wrong — instead of silently returning false in production. That makes the
 * predicate safer to export than the hand-rolled check it replaces, which had
 * no such guard.
 */
export function userCanAccessTask(task: TaskWithAccessRelations, userId: string): boolean {
  const lists = task.lists ?? []

  for (const list of lists) {
    if (list.listMembers === undefined) {
      throw new Error(
        'userCanAccessTask: task.lists was loaded without listMembers, so membership ' +
          'cannot be decided. Include lists: { include: { listMembers: true } }, or use ' +
          'getTaskForUser() which owns the shape.'
      )
    }
  }

  return (
    task.creatorId === userId ||
    task.assigneeId === userId ||
    lists.some(list => hasExplicitListRole({ id: userId }, list as never))
  )
}
