/**
 * A task edit's side effects that run AFTER its response (AWTD-1462, finding W4).
 *
 * Jon, 2026-11-01: notifications, reminder rescheduling, stats invalidation and
 * the dependents re-check may run just after the response. They used to be
 * awaited inside updateTaskWithSideEffects, about four statements of a
 * completion's eleven. Now the edit writes ONE durable `task-updated` job,
 * and only when it has some of this work to do. The job drains in after()
 * (lib/jobs/queue.ts). A function frozen mid-run leaves its lock to expire,
 * and the minute cron runs the job again.
 *
 * Unchanged:
 *   - each step is guarded on its own, exactly as it was in the request. A
 *     failure is logged and the remaining steps still run, so a failing
 *     notification never fails or retries the edit.
 *   - the inputs are the before/after pair the request saw, captured at
 *     enqueue time. A job that runs a moment later decides the same reminders,
 *     notifications, stats and dependency moves the request would have.
 *
 * Safe to run twice (a re-run after a kill): reminders cancel then re-queue
 * the same times, the stats reset and the dependents re-check are idempotent,
 * and the notification rows carry ids derived from `editKey`, inserted with
 * skipDuplicates.
 *
 * What stays before the response, and why, is on the task's Stage 0 matrix:
 * rollover, the row write, TaskEvents (not in one transaction with the edit:
 * Jon's decision (a)), the returned state-change comment, Redis invalidation
 * and the SSE broadcast.
 */

import { randomUUID } from 'crypto'
import { createLogger } from '@/lib/logger'
import { enqueueJob } from '@/lib/jobs/queue'
import type { TaskUpdatedPayload, TaskUpdatedReminderFields } from '@/lib/jobs/kinds'
import { notifyTaskUpdate } from '@/lib/notification-store'
import { taskUpdateNotificationTargets } from '@/lib/notifications'
import { notifiableUpdateEvents } from '@/lib/task-event-snapshot'
import type { TaskEventInput, TaskEventKind } from '@/lib/task-events'
import { rescheduleRemindersForUpdate } from '@/lib/reminder-scheduling'
import { remindersNeedRescheduling, type ReminderTaskFields } from '@/lib/reminder-reschedule-rule'
import { invalidateUserStats } from '@/lib/user-stats'

const log = createLogger('services.task-update-deferred-effects')

function reminderFields(task: any): TaskUpdatedReminderFields {
  return {
    id: task.id,
    title: task.title,
    completed: task.completed,
    assigneeId: task.assigneeId ?? null,
    creatorId: task.creatorId ?? null,
    dueDateTime: task.dueDateTime ?? null,
    reminderTime: task.reminderTime ?? null,
    reminderType: task.reminderType ?? null,
  }
}

const toDate = (value: string | Date | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value)

function reviveReminderFields(fields: TaskUpdatedReminderFields): ReminderTaskFields {
  return { ...fields, dueDateTime: toDate(fields.dueDateTime), reminderTime: toDate(fields.reminderTime) }
}

/**
 * The deferred work for one edit, or null when there is none (a title edit
 * nobody is notified of writes no job at all). Pure, apart from minting the
 * edit key when none is passed.
 */
export function planTaskUpdatedJob(args: {
  existingTask: any
  task: any
  actorId: string
  actorType: 'user' | 'agent'
  events: TaskEventInput[]
  editKey?: string
}): TaskUpdatedPayload | null {
  const { existingTask, task, actorId, actorType, events } = args
  const payload: TaskUpdatedPayload = {
    taskId: task.id,
    actorId,
    actorType,
    editKey: args.editKey ?? `${task.id}:${randomUUID()}`,
  }
  let hasWork = false

  // Reminders must follow the task, or a completed one keeps notifying.
  const before = reminderFields(existingTask)
  const after = reminderFields(task)
  if (remindersNeedRescheduling(before as ReminderTaskFields, after as ReminderTaskFields)) {
    payload.reminders = { before, after }
    hasWork = true
  }

  // A blocker's completion decides other tasks' lanes, in BOTH directions:
  // completing unblocks its dependents, reopening re-blocks the ones still in
  // Ready (AWTD-1002).
  if (existingTask.completed !== task.completed) {
    payload.dependents = { blockerCompleted: !!task.completed }
    hasWork = true
  }

  const commenterIds = Array.from(
    new Set(
      (task.comments ?? [])
        .map((comment: any) => comment?.authorId)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    )
  ) as string[]
  const audience = { assigneeId: task.assigneeId ?? null, creatorId: task.creatorId ?? null, commenterIds }
  // Always carried, so a job that runs calls notifyTaskUpdate exactly as the
  // request did (a no-op without rows). Only an edit that notifies somebody
  // is reason enough to write a job.
  const notifiable = notifiableUpdateEvents(events)
  payload.notifications = { kinds: notifiable.map(event => event.kind), audience }
  if (taskUpdateNotificationTargets({ actorId, events: notifiable, audience }).length > 0) hasWork = true

  const completionChanged = existingTask.completed !== task.completed
  const assignmentChanged = existingTask.assigneeId !== task.assigneeId
  if (completionChanged || assignmentChanged) {
    const statsUserIds = new Set<string>()
    if (task.assigneeId && completionChanged) statsUserIds.add(task.assigneeId)
    if (existingTask.assigneeId && assignmentChanged && existingTask.assigneeId !== task.assigneeId) {
      statsUserIds.add(existingTask.assigneeId)
    }
    if (task.creatorId && completionChanged) statsUserIds.add(task.creatorId)
    if (statsUserIds.size > 0) {
      payload.statsUserIds = Array.from(statsUserIds)
      hasWork = true
    }
  }

  return hasWork ? payload : null
}

/**
 * Queue an edit's deferred work: one INSERT on the request path, or none. Never
 * throws. enqueueJob falls back to after() itself, and a failure while planning
 * is logged like any other side-effect failure past the write.
 */
export async function enqueueTaskUpdatedEffects(args: Parameters<typeof planTaskUpdatedJob>[0]): Promise<void> {
  try {
    const payload = planTaskUpdatedJob(args)
    if (!payload) return
    await enqueueJob('task-updated', payload, { dedupeKey: `task-updated:${payload.editKey}` })
  } catch (err) {
    log.error({ err, taskId: args.task?.id }, 'Failed to queue the deferred effects of a task update')
  }
}

/** The `task-updated` job handler. Same order and same guards as the request path had. */
export async function runTaskUpdatedJob(payload: TaskUpdatedPayload): Promise<void> {
  const { taskId, actorId, actorType } = payload

  if (payload.reminders) {
    // Guards itself.
    await rescheduleRemindersForUpdate({
      before: reviveReminderFields(payload.reminders.before),
      after: reviveReminderFields(payload.reminders.after),
      actorId,
    })
  }

  if (payload.dependents) {
    // Dynamically imported for the reason the delete path in task.service gives.
    await import('@/services/task-dependency.service')
      .then(deps => deps.promoteUnblockedDependents({
        blockingTaskId: taskId,
        actorId,
        actorType: actorType === 'agent' ? 'agent' : 'user',
        blockerCompleted: payload.dependents!.blockerCompleted,
      }))
      .catch(err => log.error({ err }, 'Failed to re-evaluate tasks blocked by this one'))
  }

  if (payload.notifications) {
    try {
      // One persist for the whole update. Per-event persists defeat the
      // row-level dedupe and wrote duplicate rows (task ceaff1c5).
      await notifyTaskUpdate({
        taskId,
        actorId,
        events: payload.notifications.kinds.map(kind => ({ kind: kind as TaskEventKind })),
        audience: payload.notifications.audience,
        dedupeKey: payload.editKey,
      })
    } catch (err) {
      log.error({ err }, 'Failed to notify about task update')
    }
  }

  if (payload.statsUserIds?.length) {
    try {
      await invalidateUserStats(payload.statsUserIds)
    } catch (err) {
      log.error({ err }, 'Failed to invalidate user stats')
    }
  }
}
