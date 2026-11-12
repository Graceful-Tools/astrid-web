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
 *
 * WHICH lane a blocker change moves a task to is astrid-core's Waiting rules
 * (lib/waiting-rules.ts, Jon 2026-11-12): `waitingSettle` when a blocker
 * completes or the clock passes a date, `waitingWrite` when a blocker is added,
 * removed or reopened. Entering Waiting clears the assignee (R2); this module
 * only applies the answer.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { recordTaskEvents, type TaskEventInput } from '@/lib/task-events'
import {
  reachableTaskIds,
  shouldDemoteOnBlockerAdded,
  shouldReblockOnBlockerReopened,
  toBlockerView,
  wouldCreateDependencyCycle,
  type BlockerView,
} from '@/lib/task-dependencies'
import { READY_STATUS_ROLE, WAITING_STATUS_ROLE } from '@/lib/task-status'
import { waitingSettle, waitingWrite, type WaitingBlocker, type WaitingChange } from '@/lib/waiting-rules'
import { TASK_FULL_INCLUDE } from '@/lib/task-query-utils'
import { loadV1TaskForEvent } from '@/lib/tasks/v1-task-shape'
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
  /** Who was assigned before the move, when the move cleared them (R2): they still hear about it. */
  formerAssigneeId?: string | null
}): Promise<void> {
  const { taskId, actorId, event, broadcast, formerAssigneeId } = args
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_FULL_INCLUDE })
    if (!task) return

    await persistNotifications({
      targets: fanOutEvent({
        kind: event.kind,
        actorId,
        audience: { assigneeId: task.assigneeId ?? formerAssigneeId ?? null, creatorId: task.creatorId },
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
    // `v1Task` is the shape the web board merges — the agent shape carries no
    // statusRole, so without it the moved card stayed put (AWTD-1039).
    broadcastToUsers(audience, {
      type: 'task_updated',
      timestamp: new Date().toISOString(),
      data: { taskId, task: enrichTaskForAgent(task as never), v1Task: await loadV1TaskForEvent(taskId) },
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
  from: string | null
  to: string | null
  kind: 'status_changed' | 'unblocked'
  actorId: string | null
  actorType: 'user' | 'agent' | 'system'
  /** The Waiting rules said `assignee: "clear"` (entering Waiting, R2). */
  clearAssignee?: boolean
  formerAssigneeId?: string | null
}): Promise<boolean> {
  const { taskId, from, to, kind, actorId, actorType, clearAssignee = false, formerAssigneeId = null } = args

  const moved = await prisma.task.updateMany({
    where: { id: taskId, statusRole: from, completed: false },
    data: clearAssignee ? { statusRole: to, assigneeId: null, assigneeIds: [] } : { statusRole: to },
  })
  if (moved.count === 0) return false

  const events: TaskEventInput[] = []
  if (from !== to) events.push({ kind, from, to })
  if (clearAssignee && formerAssigneeId) events.push({ kind: 'unassigned', from: formerAssigneeId, to: null })
  const event = events[0] ?? { kind, from, to }
  await recordTaskEvents({ taskId, actorId, actorType, events })
  await announceTaskChange({ taskId, actorId, event, broadcast: true, formerAssigneeId: clearAssignee ? formerAssigneeId : null })
  return true
}

/**
 * Apply one move the scheduled Waiting job planned (services/waiting-settle-job.ts): conditional
 * on the task still being where the plan found it, announced like any move this module makes.
 */
export async function applySettlement(args: {
  taskId: string
  from: string | null
  to: string | null
  clearAssignee: boolean
  formerAssigneeId: string | null
  kind: 'status_changed' | 'unblocked'
}): Promise<boolean> {
  return moveLane({ ...args, actorId: null, actorType: 'system' })
}

/** One task as the Waiting rules read it, with its blockers. `null` when it is gone. */
async function waitingStateOf(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, statusRole: true, dueDateTime: true, isAllDay: true, assigneeId: true, completed: true },
  })
  if (!task) return null
  const rows = await prisma.taskDependency.findMany({
    where: { blockedTaskId: taskId },
    select: { blockingTaskId: true, blockingTask: { select: { completed: true } } },
  })
  const blockers: WaitingBlocker[] = rows.map(row => ({ id: row.blockingTaskId, completed: Boolean(row.blockingTask?.completed) }))
  return { task, blockers }
}

/**
 * Apply `waitingWrite` for a blocker change the task's own row did not make (added, removed,
 * reopened). Only a move into, or out of, Waiting is written; `none` and `stay` write nothing.
 */
async function applyWaitingWrite(args: {
  taskId: string
  blockers: WaitingBlocker[]
  change: WaitingChange
  kind: 'status_changed' | 'unblocked'
  actorId: string | null
  actorType: 'user' | 'agent' | 'system'
  now: Date
}): Promise<boolean> {
  const state = await waitingStateOf(args.taskId)
  if (!state || state.task.completed) return false
  const answer = waitingWrite(state.task, args.blockers, args.change, args.now)
  if (!answer.ok) return false
  const { transition, statusRole, assignee } = answer.value
  if (transition === 'none' || transition === 'stay') return false
  return moveLane({
    taskId: args.taskId,
    from: state.task.statusRole ?? null,
    to: statusRole,
    kind: args.kind,
    actorId: args.actorId,
    actorType: args.actorType,
    clearAssignee: assignee === 'clear',
    formerAssigneeId: state.task.assigneeId,
  })
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
  now?: Date
}): Promise<AddBlockerResult | DependencyFailure> {
  const { taskId, blockingTaskId, userId, actorType = 'user', now = new Date() } = args

  const blocked = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, statusRole: true },
  })
  if (!blocked) return { ok: false, status: 404, error: 'Task not found' }

  const candidate = await checkBlockerCandidate({ taskId, blockingTaskId, userId })
  if (!candidate.ok) return candidate

  const before = await waitingStateOf(taskId)
  const created = await attachBlocker({ taskId, blockingTaskId, userId, actorType })

  // Ready means "actionable now", and a blocked task is not: a Ready task given an open blocker
  // enters Waiting — through the Waiting rules, so it is unassigned as any entry is (R2). A Doing
  // task, or one in a custom column, is left where it is.
  if (created && before && shouldDemoteOnBlockerAdded(blocked.statusRole) && !candidate.completed) {
    await applyWaitingWrite({
      taskId,
      blockers: before.blockers,
      change: { statusRole: WAITING_STATUS_ROLE, addBlockers: [{ id: blockingTaskId, completed: false }] },
      kind: 'status_changed',
      actorId: userId,
      actorType,
      now,
    })
  }

  const { blockedBy } = await getBlockersForTask(taskId, userId)
  return { ok: true, created, blockedBy }
}

/**
 * May `userId` make `taskId` wait on `blockingTaskId`? Read access to the blocking task (pointing
 * at a task is not modifying it) and no cycle. `taskId` null is a task not created yet, which no
 * cycle can reach. Shared by the blocker route and `waitOnTaskId` on task writes (services/task-waiting.ts).
 */
export async function checkBlockerCandidate(args: {
  taskId: string | null
  blockingTaskId: string
  userId: string
}): Promise<{ ok: true; completed: boolean } | DependencyFailure> {
  const { taskId, blockingTaskId, userId } = args
  const blockerAccess = await getTaskForUser(blockingTaskId, userId)
  if (!blockerAccess.ok) {
    return blockerAccess.status === 404
      ? { ok: false, status: 404, error: 'Blocking task not found' }
      : { ok: false, status: 403, error: 'Access denied to the blocking task' }
  }
  if (taskId && (await wouldCreateDependencyCycle({ blockedTaskId: taskId, blockingTaskId, blockersOf }))) {
    return {
      ok: false,
      status: 409,
      error: 'That would make two tasks wait for each other',
      reason: 'dependency_cycle',
    }
  }
  return { ok: true, completed: Boolean(blockerAccess.task.completed) }
}

/**
 * Write one link and its activity line; no lane decision (the caller has made it). Idempotent:
 * false when the link already existed.
 */
export async function attachBlocker(args: {
  taskId: string
  blockingTaskId: string
  userId: string
  actorType?: 'user' | 'agent'
}): Promise<boolean> {
  const { taskId, blockingTaskId, userId, actorType = 'user' } = args
  const existing = await prisma.taskDependency.findUnique({
    where: { blockedTaskId_blockingTaskId: { blockedTaskId: taskId, blockingTaskId } },
    select: { id: true },
  })
  if (existing) return false
  await prisma.taskDependency.create({
    data: { blockedTaskId: taskId, blockingTaskId, createdById: userId },
  })
  await recordTaskEvents({
    taskId,
    actorId: userId,
    actorType,
    events: [{ kind: 'blocker_added', to: { blockingTaskId } }],
  })
  return true
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

  const before = await waitingStateOf(taskId)
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
    // Taking away the last condition of a Waiting task wakes it (R2/R3) — to Ready, since it had one.
    if (before) {
      await applyWaitingWrite({
        taskId,
        blockers: before.blockers,
        change: { removeBlockerIds: [blockingTaskId] },
        kind: 'unblocked',
        actorId: userId,
        actorType,
        now,
      })
    }
  }

  const { blockedBy } = await getBlockersForTask(taskId, userId)
  return { ok: true, removed: removed.count > 0, blockedBy }
}

/**
 * Settle ONE Waiting task through astrid-core's `waitingSettle` (R3): to Ready when nothing holds
 * it any more. Only a task in Waiting is touched here — parking a dated Ready task (R5) is the
 * scheduled settle job's (services/waiting-settle-job.ts), behind its own mode switch.
 */
async function promoteIfUnblocked(args: {
  taskId: string
  actorId: string | null
  actorType: 'user' | 'agent' | 'system'
  now: Date
}): Promise<boolean> {
  const { taskId, actorId, actorType, now } = args

  const state = await waitingStateOf(taskId)
  if (!state || state.task.completed) return false
  if ((state.task.statusRole ?? '') !== WAITING_STATUS_ROLE) return false

  const settlement = waitingSettle(state.task, state.blockers, now)
  if (settlement.action !== 'wakeToReady' && settlement.action !== 'resolveToInbox') return false

  return moveLane({
    taskId,
    from: WAITING_STATUS_ROLE,
    to: settlement.statusRole,
    kind: 'unblocked',
    actorId,
    actorType,
    clearAssignee: settlement.assignee === 'clear',
    formerAssigneeId: state.task.assigneeId,
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

      // Reopened: only a dependent sitting in Ready goes back to Waiting — entering it through the
      // Waiting rules, the reopened blocker being its condition (and so unassigned, R2).
      if (shouldReblockOnBlockerReopened(blockedTask.statusRole) && !blockedTask.completed) {
        const state = await waitingStateOf(blockedTask.id)
        const moved = state
          ? await applyWaitingWrite({
              taskId: blockedTask.id,
              blockers: state.blockers,
              change: { statusRole: WAITING_STATUS_ROLE },
              kind: 'status_changed',
              actorId,
              actorType,
              now,
            })
          : false
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
  /**
   * The blocker that went (a deleted task): its rows have cascaded, so it is put back as an open
   * blocker and removed in the change. Losing the last condition then WAKES the task to Ready
   * (R2), rather than reading as a task that never had one and landing in Inbox.
   */
  removedBlockerId?: string
}): Promise<string[]> {
  const { taskIds, actorId = null, actorType = 'user', now = new Date(), removedBlockerId } = args
  const promoted: string[] = []

  for (const taskId of taskIds) {
    try {
      if (removedBlockerId) {
        const state = await waitingStateOf(taskId)
        if (!state) continue
        const moved = await applyWaitingWrite({
          taskId,
          blockers: [...state.blockers, { id: removedBlockerId, completed: false }],
          change: { removeBlockerIds: [removedBlockerId] },
          kind: 'unblocked',
          actorId,
          actorType,
          now,
        })
        if (moved) promoted.push(taskId)
        continue
      }
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
