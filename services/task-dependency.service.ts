/**
 * "Waiting on tasks" — the database half of task-to-task blocking (AWTD-1002).
 *
 * Spec of record: docs/specs/TASK_BLOCKING_DEPENDENCIES.md. The DECISIONS live
 * in lib/task-dependencies.ts, which is pure and testable without a Postgres;
 * this module is the queries, the permission checks and the writes.
 *
 * The promotion gate is idempotent and its write is conditional — it promotes
 * only a task whose `statusRole` is still `waiting`. A task somebody has since
 * dragged to Doing, completed, or parked in a project's custom state is not the
 * promoter's to move, and BOTH triggers (a blocker completing, and the clock
 * reaching a date) re-evaluate the whole condition rather than trusting what
 * woke them. So three blockers finished in any order — or finished while the
 * cron was failing — land in the same place.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { recordTaskEvents, type TaskEventInput } from '@/lib/task-events'
import {
  isPromotableAfterBlockerChange,
  reachableTaskIds,
  shouldDemoteOnBlockerAdded,
  shouldReblockOnBlockerReopened,
  toBlockerView,
  wouldCreateDependencyCycle,
  type BlockerView,
} from '@/lib/task-dependencies'
import { READY_STATUS_ROLE, WAITING_STATUS_ROLE } from '@/lib/task-status'
import { TASK_FULL_INCLUDE } from '@/lib/task-query-utils'
import { audienceForTask } from '@/lib/deletion-log'
import { broadcastToUsers } from '@/lib/sse-utils'
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { fanOutEvent } from '@/lib/notifications'
import { persistNotifications } from '@/lib/notification-store'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { getTaskForUser } from '@/services/task.service'

const log = createLogger('services.task-dependency')

export type DependencyFailure =
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 403; error: string }
  | { ok: false; status: 409; error: string; reason: 'dependency_cycle' }

export interface BlockerLists {
  /** Tasks this one is waiting for. */
  blockedBy: BlockerView[]
  /** Tasks waiting for this one. */
  blocks: BlockerView[]
  /**
   * Every task that waits on this one, transitively — the tasks it may NOT be
   * made to wait on, because that would close a cycle. The picker drops them
   * so it never offers a choice the write would refuse. Only tasks the reader
   * may see: an id is information, and the picker only needs to filter search
   * hits, which are visible by construction.
   */
  dependentIds: string[]
}

const BLOCKER_SELECT = {
  id: true,
  title: true,
  identifier: true,
  completed: true,
} as const

/** The edges out of one task, for the cycle walk. */
async function blockersOf(taskId: string): Promise<string[]> {
  const rows = await prisma.taskDependency.findMany({
    where: { blockedTaskId: taskId },
    select: { blockingTaskId: true },
  })
  return rows.map(row => row.blockingTaskId)
}

/** The edges into one task — who is waiting on it. */
async function dependentsOf(taskId: string): Promise<string[]> {
  const rows = await prisma.taskDependency.findMany({
    where: { blockingTaskId: taskId },
    select: { blockedTaskId: true },
  })
  return rows.map(row => row.blockedTaskId)
}

/**
 * Tell everyone whose view of a task just changed, when the change was made BY
 * THE GATE rather than by a person dragging a card.
 *
 * That distinction is why this exists. A person's own edit goes through
 * `updateTaskWithSideEffects`, which broadcasts, invalidates the cache and
 * notifies. The gate writes `statusRole` directly, and without this the card
 * sat in its old column on every open board — the actor's included, since they
 * never touched this card and so have no optimistic update showing it — until
 * a refresh. The spec's reason for the completion trigger was the opposite:
 * "unblock the next card while they are looking at the board".
 *
 * So the actor is NOT excluded from the broadcast, unlike the update path.
 * They are excluded from the notification, by `fanOutEvent`, because being
 * told about your own action is noise.
 *
 * Best-effort throughout: the move has already happened, and failing to
 * announce it must not turn a successful write into an error.
 */
async function announceTaskChange(args: {
  taskId: string
  actorId: string | null
  event: TaskEventInput
  broadcast: boolean
}): Promise<void> {
  const { taskId, actorId, event, broadcast } = args
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_FULL_INCLUDE })
    if (!task) return

    await persistNotifications({
      targets: fanOutEvent({
        kind: event.kind,
        actorId,
        audience: { assigneeId: task.assigneeId, creatorId: task.creatorId },
      }),
      context: { taskId, actorId },
    })

    if (!broadcast) return

    const audience = audienceForTask(task as never)
    // Invalidated BEFORE the broadcast, so a client that refetches on the nudge
    // cannot be served the pre-move rows.
    if (await isRedisAvailable()) {
      await Promise.all(audience.map(userId => RedisCache.del(RedisCache.keys.userTasks(userId))))
    }
    // The FULL task, not a patch: the web cache stores the payload as the task.
    broadcastToUsers(audience, {
      type: 'task_updated',
      timestamp: new Date().toISOString(),
      data: { taskId, task: enrichTaskForAgent(task as never) },
    })
  } catch (err) {
    log.error({ err, taskId }, 'Failed to announce a task the blocker gate changed')
  }
}

/**
 * Move one card between lanes on the gate's authority — the ONLY way this
 * module changes a task's status.
 *
 * Conditional in the `where` clause rather than read-then-write: two blockers
 * completing at the same moment both get here, and the database is the only
 * place that race can be settled. A task somebody has since moved, completed,
 * or parked in a custom state is not the gate's to move.
 */
async function moveLane(args: {
  taskId: string
  from: string
  to: string
  kind: 'status_changed' | 'unblocked'
  actorId: string | null
  actorType: 'user' | 'agent' | 'system'
}): Promise<boolean> {
  const { taskId, from, to, kind, actorId, actorType } = args

  const moved = await prisma.task.updateMany({
    where: { id: taskId, statusRole: from, completed: false },
    data: { statusRole: to },
  })
  if (moved.count === 0) return false

  const event: TaskEventInput = { kind, from, to }
  await recordTaskEvents({ taskId, actorId, actorType, events: [event] })
  await announceTaskChange({ taskId, actorId, event, broadcast: true })
  return true
}

/**
 * Which of these tasks may `userId` actually see?
 *
 * A blocker crossing a list boundary is the normal case, not an edge one, so
 * this is asked for every render. `getTaskForUser` owns the rule (creator,
 * assignee, or an explicit role on one of the task's lists) — never an inlined
 * `ownerId === user.id`, per docs/CODE_REUSE_AND_CONSISTENCY.md.
 */
async function visibleTaskIds(taskIds: string[], userId: string): Promise<Set<string>> {
  const visible = new Set<string>()
  await Promise.all(
    taskIds.map(async id => {
      const access = await getTaskForUser(id, userId)
      if (access.ok) visible.add(id)
    }),
  )
  return visible
}

/** Both directions, with anything the reader may not see reduced to an id. */
export async function getBlockersForTask(
  taskId: string,
  userId: string,
): Promise<BlockerLists> {
  const [blockedByRows, blocksRows] = await Promise.all([
    prisma.taskDependency.findMany({
      where: { blockedTaskId: taskId },
      select: { blockingTask: { select: BLOCKER_SELECT } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.taskDependency.findMany({
      where: { blockingTaskId: taskId },
      select: { blockedTask: { select: BLOCKER_SELECT } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const blockedByTasks = blockedByRows.map(row => row.blockingTask)
  const blocksTasks = blocksRows.map(row => row.blockedTask)
  const dependents = [...(await reachableTaskIds(taskId, dependentsOf))].filter(id => id !== taskId)
  const visible = await visibleTaskIds(
    [...new Set([...blockedByTasks, ...blocksTasks].map(task => task.id).concat(dependents))],
    userId,
  )

  return {
    blockedBy: blockedByTasks.map(task => toBlockerView(task, visible.has(task.id))),
    blocks: blocksTasks.map(task => toBlockerView(task, visible.has(task.id))),
    dependentIds: dependents.filter(id => visible.has(id)),
  }
}

export interface AddBlockerResult {
  ok: true
  /** False when the link already existed — the unique constraint makes this idempotent. */
  created: boolean
  blockedBy: BlockerView[]
}

/**
 * Block `taskId` on `blockingTaskId`.
 *
 * Writing a dependency needs write access to the BLOCKED task (the caller's
 * route has already required it) and READ access to the blocking one — pointing
 * at a task is not modifying it.
 */
export async function addBlocker(args: {
  taskId: string
  blockingTaskId: string
  userId: string
  actorType?: 'user' | 'agent'
}): Promise<AddBlockerResult | DependencyFailure> {
  const { taskId, blockingTaskId, userId, actorType = 'user' } = args

  const blocked = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, statusRole: true },
  })
  if (!blocked) return { ok: false, status: 404, error: 'Task not found' }

  const blockerAccess = await getTaskForUser(blockingTaskId, userId)
  if (!blockerAccess.ok) {
    return blockerAccess.status === 404
      ? { ok: false, status: 404, error: 'Blocking task not found' }
      : { ok: false, status: 403, error: 'Access denied to the blocking task' }
  }

  if (await wouldCreateDependencyCycle({ blockedTaskId: taskId, blockingTaskId, blockersOf })) {
    return {
      ok: false,
      status: 409,
      error: 'That would make two tasks wait for each other',
      reason: 'dependency_cycle',
    }
  }

  const existing = await prisma.taskDependency.findUnique({
    where: { blockedTaskId_blockingTaskId: { blockedTaskId: taskId, blockingTaskId } },
    select: { id: true },
  })

  if (!existing) {
    await prisma.taskDependency.create({
      data: { blockedTaskId: taskId, blockingTaskId, createdById: userId },
    })

    await recordTaskEvents({
      taskId,
      actorId: userId,
      actorType,
      events: [{ kind: 'blocker_added', to: { blockingTaskId } }],
    })

    // Ready means "actionable now", and a blocked task is not. A Doing task is
    // left where it is — see shouldDemoteOnBlockerAdded.
    if (
      shouldDemoteOnBlockerAdded(blocked.statusRole) &&
      !blockerAccess.task.completed
    ) {
      await moveLane({
        taskId,
        from: READY_STATUS_ROLE,
        to: WAITING_STATUS_ROLE,
        kind: 'status_changed',
        actorId: userId,
        actorType,
      })
    }
  }

  const { blockedBy } = await getBlockersForTask(taskId, userId)
  return { ok: true, created: !existing, blockedBy }
}

/**
 * Remove one link, then re-run the gate.
 *
 * Removing the last outstanding blocker unblocks the task, exactly as
 * completing it would — the gate is the same function either way.
 */
export async function removeBlocker(args: {
  taskId: string
  blockingTaskId: string
  userId: string
  actorType?: 'user' | 'agent'
  now?: Date
}): Promise<{ ok: true; removed: boolean; blockedBy: BlockerView[] } | DependencyFailure> {
  const { taskId, blockingTaskId, userId, actorType = 'user', now = new Date() } = args

  const removed = await prisma.taskDependency.deleteMany({
    where: { blockedTaskId: taskId, blockingTaskId },
  })

  if (removed.count > 0) {
    await recordTaskEvents({
      taskId,
      actorId: userId,
      actorType,
      events: [{ kind: 'blocker_removed', to: { blockingTaskId } }],
    })
    await promoteIfUnblocked({ taskId, actorId: userId, actorType, now })
  }

  const { blockedBy } = await getBlockersForTask(taskId, userId)
  return { ok: true, removed: removed.count > 0, blockedBy }
}

/** The blockers of `taskId` that are still open. */
async function outstandingBlockerIds(taskId: string): Promise<string[]> {
  const rows = await prisma.taskDependency.findMany({
    where: { blockedTaskId: taskId, blockingTask: { completed: false } },
    select: { blockingTaskId: true },
  })
  return rows.map(row => row.blockingTaskId)
}

/** Promote ONE task if nothing holds it any more. The write is `moveLane`'s. */
async function promoteIfUnblocked(args: {
  taskId: string
  actorId: string | null
  actorType: 'user' | 'agent' | 'system'
  now: Date
}): Promise<boolean> {
  const { taskId, actorId, actorType, now } = args

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, statusRole: true, dueDateTime: true, completed: true },
  })
  if (!task || task.completed) return false
  if ((task.statusRole ?? '') !== WAITING_STATUS_ROLE) return false

  const outstanding = await outstandingBlockerIds(taskId)
  if (!isPromotableAfterBlockerChange({
    dueDateTime: task.dueDateTime,
    now,
    outstandingBlockerIds: outstanding,
  })) {
    return false
  }

  return moveLane({
    taskId,
    from: WAITING_STATUS_ROLE,
    to: READY_STATUS_ROLE,
    kind: 'unblocked',
    actorId,
    actorType,
  })
}

/**
 * A blocker changed — promote whatever it was holding, or re-block it.
 *
 * Called from the task service when a task's completion flips in either
 * direction, and when a task is deleted (the rows cascade, so the dependents
 * simply have one fewer blocker). Best-effort by design: the user's own write
 * has already happened, and a failure here must not turn a successful
 * completion into an error.
 */
export async function promoteUnblockedDependents(args: {
  blockingTaskId: string
  actorId?: string | null
  actorType?: 'user' | 'agent' | 'system'
  /** The blocker's completion AFTER the change. Reopening re-blocks. */
  blockerCompleted: boolean
  now?: Date
}): Promise<{ promoted: string[]; reblocked: string[] }> {
  const {
    blockingTaskId,
    actorId = null,
    actorType = 'user',
    blockerCompleted,
    now = new Date(),
  } = args

  const promoted: string[] = []
  const reblocked: string[] = []

  const dependents = await prisma.taskDependency.findMany({
    where: { blockingTaskId },
    select: { blockedTask: { select: { id: true, statusRole: true, completed: true } } },
  })

  for (const { blockedTask } of dependents) {
    try {
      if (blockerCompleted) {
        if (await promoteIfUnblocked({ taskId: blockedTask.id, actorId, actorType, now })) {
          promoted.push(blockedTask.id)
        }
        continue
      }

      // Reopened: only a dependent sitting in Ready goes back to Waiting.
      if (shouldReblockOnBlockerReopened(blockedTask.statusRole)) {
        const moved = await moveLane({
          taskId: blockedTask.id,
          from: READY_STATUS_ROLE,
          to: WAITING_STATUS_ROLE,
          kind: 'status_changed',
          actorId,
          actorType,
        })
        if (moved) reblocked.push(blockedTask.id)
        continue
      }

      // A dependent already in Waiting is still held; nothing new to say.
      if ((blockedTask.statusRole ?? '') === WAITING_STATUS_ROLE && !blockedTask.completed) continue

      // Doing, Done, or a custom state: left where it is, because yanking a
      // card out from under someone is worse than a stale lane. The spec's
      // other half is that they HEAR about it — they are the only one who can
      // judge whether the reopened blocker actually stops them.
      const event: TaskEventInput = { kind: 'blocker_reopened', to: { blockingTaskId } }
      await recordTaskEvents({ taskId: blockedTask.id, actorId, actorType, events: [event] })
      await announceTaskChange({ taskId: blockedTask.id, actorId, event, broadcast: false })
    } catch (err) {
      log.error({ err, taskId: blockedTask.id }, 'Failed to re-evaluate a blocked task')
    }
  }

  return { promoted, reblocked }
}

/**
 * Which tasks are waiting on this one? Read BEFORE a delete.
 *
 * `onDelete: Cascade` takes the rows with the task, so asking afterwards
 * returns nobody — a dependent would sit in Waiting on a blocker that no longer
 * exists, which is the one state this feature must never produce.
 */
export async function findDependentTaskIds(blockingTaskId: string): Promise<string[]> {
  const rows = await prisma.taskDependency.findMany({
    where: { blockingTaskId },
    select: { blockedTaskId: true },
  })
  return rows.map(row => row.blockedTaskId)
}

/** Re-run the gate on tasks whose blocker set just changed underneath them. */
export async function reevaluateBlockedTasks(args: {
  taskIds: string[]
  actorId?: string | null
  actorType?: 'user' | 'agent' | 'system'
  now?: Date
}): Promise<string[]> {
  const { taskIds, actorId = null, actorType = 'user', now = new Date() } = args
  const promoted: string[] = []

  for (const taskId of taskIds) {
    try {
      if (await promoteIfUnblocked({ taskId, actorId, actorType, now })) {
        promoted.push(taskId)
      }
    } catch (err) {
      log.error({ err, taskId }, 'Failed to re-evaluate a blocked task')
    }
  }

  return promoted
}

/**
 * The clock half of the gate.
 *
 * Nothing happens to a task when its own date arrives, so something has to
 * notice — the per-minute reminders cron, which already sweeps for work whose
 * moment has come. Only DATED tasks need it: an undated one is promoted by the
 * blocker that cleared, which is the only event it has.
 */
export async function promoteDueUnblockedTasks(now: Date = new Date()): Promise<string[]> {
  const candidates = await prisma.task.findMany({
    where: {
      statusRole: WAITING_STATUS_ROLE,
      completed: false,
      dueDateTime: { lte: now },
      blockedBy: { some: {} },
    },
    select: { id: true },
  })

  const promoted: string[] = []
  for (const candidate of candidates) {
    try {
      if (
        await promoteIfUnblocked({
          taskId: candidate.id,
          actorId: null,
          actorType: 'system',
          now,
        })
      ) {
        promoted.push(candidate.id)
      }
    } catch (err) {
      log.error({ err, taskId: candidate.id }, 'Failed to promote a due unblocked task')
    }
  }

  return promoted
}
