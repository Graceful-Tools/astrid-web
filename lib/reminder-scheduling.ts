/**
 * Server-side reminder scheduling helpers (Prisma-backed).
 *
 * The route handlers for task create/update/delete each had inline
 * reminder-queue logic — cancel pending rows, decide which reminders
 * to schedule, insert them. This module is the single source of truth
 * for that behavior so POST and PUT can't drift apart.
 *
 * NOT to be confused with lib/reminder-manager.ts (client-side, in-memory)
 * or lib/reminder-service.ts (also server-side but for triggering, not
 * scheduling).
 */

import { prisma } from "./prisma"
import { createLogger } from "./logger"

const log = createLogger("reminder-scheduling")

export type ReminderType = "due_reminder" | "overdue_reminder"

export interface ReminderScheduleEntry {
  scheduledFor: Date
  type: ReminderType
  /**
   * Free-form provenance string written into the reminder row's `data.source`.
   * Existing routes use "explicit", "automatic", or "automatic_update".
   */
  source: string
}

/**
 * Compute the standard automatic reminder schedule for a task with a due
 * date: a 15-minute-before reminder (or due-time itself if <15min away) +
 * an overdue reminder 1 hour after due. Returns empty array for past
 * due dates.
 */
export function computeAutomaticReminders(
  dueDate: Date,
  source: string = "automatic",
): ReminderScheduleEntry[] {
  const now = new Date()
  if (dueDate <= now) return []

  const entries: ReminderScheduleEntry[] = []

  // 15-min-before — if less than 15min away, fire at due-time itself.
  const reminderTime = new Date(dueDate.getTime() - 15 * 60 * 1000)
  entries.push({
    scheduledFor: reminderTime > now ? reminderTime : dueDate,
    type: "due_reminder",
    source,
  })

  // Overdue reminder 1 hour after due.
  entries.push({
    scheduledFor: new Date(dueDate.getTime() + 60 * 60 * 1000),
    type: "overdue_reminder",
    source,
  })

  return entries
}

/**
 * Cancel every pending reminder row for a task by flipping status to
 * "cancelled". Uses updateMany so it's a no-op when there are none.
 */
export async function cancelPendingReminders(taskId: string): Promise<void> {
  await prisma.reminderQueue.updateMany({
    where: { taskId, status: "pending" },
    data: { status: "cancelled" },
  })
  log.info({ taskId }, "Cancelled existing reminders")
}

interface ScheduleArgs {
  taskId: string
  taskTitle: string
  /** User who receives the reminder (assignee/creator/current user). */
  userId: string
  reminders: ReminderScheduleEntry[]
  /**
   * If true, check for an existing pending reminder at the same scheduledFor
   * + type before inserting. Mirrors the POST route's duplicate-avoidance.
   * The PUT path doesn't need this because it cancels first.
   */
  checkDuplicates?: boolean
  /**
   * Optional reminder-type label passed through into row.data.reminderType
   * (POST route uses this; PUT route doesn't).
   */
  reminderTypeLabel?: string
}

/**
 * Insert reminder rows. Errors on individual rows are logged but don't
 * abort the rest — same behavior as the inline implementations the
 * routes had before.
 */
export async function scheduleReminders(args: ScheduleArgs): Promise<void> {
  const { taskId, taskTitle, userId, reminders, checkDuplicates, reminderTypeLabel } = args

  for (const reminder of reminders) {
    try {
      if (checkDuplicates) {
        const existing = await prisma.reminderQueue.findFirst({
          where: {
            taskId,
            type: reminder.type,
            scheduledFor: reminder.scheduledFor,
            status: "pending",
          },
        })
        if (existing) {
          log.info(
            { taskId, type: reminder.type, scheduledFor: reminder.scheduledFor },
            "Reminder already exists, skipping",
          )
          continue
        }
      }

      await prisma.reminderQueue.create({
        data: {
          taskId,
          userId,
          scheduledFor: reminder.scheduledFor,
          type: reminder.type,
          status: "pending",
          data: {
            taskTitle,
            taskId,
            source: reminder.source,
            ...(reminderTypeLabel ? { reminderType: reminderTypeLabel } : {}),
          },
        },
      })
      log.info(
        { taskId, type: reminder.type, scheduledFor: reminder.scheduledFor, source: reminder.source },
        "Added reminder to queue",
      )
    } catch (err) {
      log.error({ err, taskId, type: reminder.type }, "Failed to add reminder to queue")
    }
  }
}

/** The task columns a reminder decision reads. */
interface ReminderTaskFields {
  id: string
  title: string
  completed: boolean
  assigneeId: string | null
  creatorId: string | null
  dueDateTime: Date | null
  reminderTime?: Date | null
  reminderType?: string | null
}

const sameTime = (a?: Date | null, b?: Date | null) => a?.getTime() === b?.getTime()

/**
 * The update path: when a change touches what reminders depend on — due date,
 * completion, assignee or the reminder itself — cancel the task's pending
 * reminders and schedule what the create path would: the explicit reminder if
 * one is still to come, otherwise the automatic-update set for a future due
 * date. Nothing is re-queued for a completed task.
 *
 * Wraps both cancellation and insertion in a try/catch — a reminder
 * failure must never fail the surrounding task update.
 */
export async function rescheduleRemindersForUpdate(args: {
  before: ReminderTaskFields
  after: ReminderTaskFields
  /** Receives the reminder when the task has neither assignee nor creator. */
  actorId: string
}): Promise<void> {
  const { before, after: task, actorId } = args
  if (
    sameTime(before.dueDateTime, task.dueDateTime) &&
    sameTime(before.reminderTime, task.reminderTime) &&
    before.completed === task.completed &&
    before.assigneeId === task.assigneeId
  ) {
    return
  }

  try {
    await cancelPendingReminders(task.id)

    if (task.completed) return

    // A snoozed reminder (AWTD-1038) is the explicit one; a past one has fired
    // or been missed, and the due date's own schedule takes over.
    const reminders: ReminderScheduleEntry[] =
      task.reminderTime && task.reminderTime > new Date()
        ? [{ scheduledFor: task.reminderTime, type: "due_reminder", source: "explicit" }]
        : task.dueDateTime
          ? computeAutomaticReminders(task.dueDateTime, "automatic_update")
          : []
    if (reminders.length === 0) return

    await scheduleReminders({
      taskId: task.id,
      taskTitle: task.title,
      userId: task.assigneeId || task.creatorId || actorId,
      reminders,
      reminderTypeLabel: task.reminderType ?? undefined,
    })
  } catch (err) {
    log.error({ err, taskId: task.id }, "Failed to reschedule reminders for task update")
  }
}
