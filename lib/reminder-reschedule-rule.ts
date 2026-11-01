/**
 * When a task edit has to reschedule its reminders. Pure, and kept apart from
 * lib/reminder-scheduling.ts (which writes the queue) so the update path can
 * decide whether there is reminder work to defer without loading the writer
 * (AWTD-1462).
 */

/** The task columns a reminder decision reads. */
export interface ReminderTaskFields {
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

/** Does this change touch what reminders depend on: due date, completion, assignee or the reminder itself? */
export function remindersNeedRescheduling(before: ReminderTaskFields, after: ReminderTaskFields): boolean {
  return !(
    sameTime(before.dueDateTime, after.dueDateTime) &&
    sameTime(before.reminderTime, after.reminderTime) &&
    before.completed === after.completed &&
    before.assigneeId === after.assigneeId
  )
}
