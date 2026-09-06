/**
 * Task service — slice 1 of the service layer.
 *
 * Task 017a569a. Jon: "We should. It ha[s] routes talk to prisma directly.
 * Build this one slice at a time." This is that first slice, and it is
 * deliberately one function rather than a full CRUD surface.
 *
 * WHY THIS FUNCTION FIRST. The point of a service layer is not to wrap Prisma
 * — a pass-through adds indirection and buys nothing. It is to stop a RULE
 * from being re-implemented per route. `getTaskForUser` is the rule that was
 * most repeated and has already caused bugs twice:
 *
 *   - lib/task-batch-copy.ts records one: the access check resolves membership
 *     from `lists.listMembers`, and a caller that fetched with `lists: true`
 *     silently had only `ownerId` able to match. A member of the list was told
 *     they had no access to a task they could see in the UI (task 73733c3d).
 *
 *   - app/api/coding-workflow/start-tools-workflow had NO check at all. Any
 *     signed-in user could POST another user's taskId and start an AI coding
 *     workflow against it, spending the list owner's configured API keys.
 *     Found while writing this slice, and fixed by adopting it.
 *
 * Both failures share a cause: the INCLUDE SHAPE and the CHECK were separate
 * things a route had to remember to pair. Here they cannot come apart — the
 * include is not exported for use without the check.
 *
 * SCOPE, so this does not sprawl. `services/` is for rules that span routes.
 * Query shapes with no rule attached stay in `lib/` (lib/task-query-utils.ts
 * and the twenty-odd lib/task-*.ts modules), which is a working pattern and is
 * not being migrated. A service that does nothing but forward to Prisma should
 * not be written.
 */

import { prisma } from '@/lib/prisma'
import { hasExplicitListRole } from '@/lib/list-permissions'
import { audienceForTask, recordDeletion } from '@/lib/deletion-log'
import { cancelActiveCodingWorkflow } from '@/lib/tasks/cancel-active-coding-workflow'
import { syncManualSortMemberships } from '@/lib/tasks/sync-manual-sort-memberships'
import { broadcastToUsers } from '@/lib/sse-utils'
import { RedisCache, isRedisAvailable } from '@/lib/redis'

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

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2: the DELETE verb (epic 9dedd8aa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete a task, with every side effect the delete implies.
 *
 * Four surfaces deleted tasks and only two of them recorded a tombstone:
 *
 *   app/api/tasks/[id]                        ✅
 *   app/api/v1/tasks/[id]                     ✅
 *   app/api/mcp/operations/…/task-operations  ❌ hard-deleted, no tombstone
 *   mcp/handlers/tasks.ts                     ❌ hard-deleted, no tombstone
 *
 * That is not a cosmetic divergence. lib/deletion-log.ts exists so that
 * `updatedSince` is safe to act on; without a tombstone, a task deleted over
 * MCP is invisible to every delta-syncing client FOREVER — iOS and Mac keep
 * showing it until a full refetch. The sync guarantee was simply false for two
 * of the four ways to delete something.
 *
 * The ORDER here is the part that is easy to get wrong and impossible to
 * notice: the audience has to be read BEFORE the row goes, because the
 * relations go with it. Reading afterwards yields nobody, and a tombstone with
 * no audience reaches no one — which looks exactly like working code.
 *
 * Every side effect is best-effort. The user asked for the row to go and it
 * has; a failed tombstone is a sync inconvenience, not a reason to report
 * failure for something that already happened.
 *
 * Permission is NOT checked here. Each surface authenticates differently (web
 * session, OAuth scope, MCP token) and has already decided; a second, weaker
 * check here would either duplicate that or quietly disagree with it. Call this
 * only after your surface has authorised the delete.
 */
export async function deleteTaskWithSideEffects(args: {
  taskId: string
  /** Who is deleting — excluded from the SSE fan-out, since they already know. */
  actorId: string
  /** Shown in the SSE payload; surfaces that have it can pass it. */
  actorName?: string
}): Promise<{ deleted: boolean; audience: string[] }> {
  const { taskId, actorId, actorName } = args

  // Read the audience while the relations still exist.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      lists: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          listMembers: { select: { userId: true } },
        },
      },
    },
  })

  if (!task) {
    return { deleted: false, audience: [] }
  }

  const audience = audienceForTask(task as never)
  const previousListIds = (task.lists ?? []).map(list => list.id)
  const listNames = (task.lists ?? []).map(list => list.name)

  // Stop the agent before removing the thing it is working on.
  await cancelActiveCodingWorkflow({ taskId, reason: 'Task deleted' })

  await prisma.task.delete({ where: { id: taskId } })

  // Everything below is best-effort: the row is already gone. try/await rather
  // than .catch() so a caller that stubs these with a plain function — as a
  // test reasonably might — does not turn a swallowed failure into a thrown
  // TypeError on `undefined.catch`.
  try {
    await recordDeletion('task', taskId, audience)
  } catch {
    // A missing tombstone costs a delta-syncing client a stale row until its
    // next full refetch. It must not cost the user their delete.
  }

  try {
    await syncManualSortMemberships({
      taskId,
      previousListIds,
      requestedListIds: [],
    })
  } catch {
    // A stale entry in a manual sort order is dropped on the next read.
  }

  // Cached task lists go stale the moment the row goes.
  try {
    if (await isRedisAvailable()) {
      await Promise.all(
        audience.map(userId => RedisCache.del(RedisCache.keys.userTasks(userId)))
      )
    }
  } catch {
    // A stale cache entry expires on its own; the delete is already done.
  }

  try {
    const recipients = audience.filter(id => id !== actorId)
    if (recipients.length > 0) {
      broadcastToUsers(recipients, {
        type: 'task_deleted',
        timestamp: new Date().toISOString(),
        data: {
          taskId,
          taskTitle: task.title,
          deleterName: actorName ?? null,
          userId: actorId,
          listNames,
        },
      })
    }
  } catch {
    // A missed SSE nudge costs a refresh, not correctness — the tombstone above
    // is what makes the deletion durable for delta sync.
  }

  return { deleted: true, audience }
}
