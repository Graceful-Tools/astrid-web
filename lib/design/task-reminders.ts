/**
 * Whether a task's details show its Reminder row (AWTD-1577).
 *
 * Off until someone turns it on in Appearance: Jon asked for reminders to leave
 * task details "unless a user opts in". The choice belongs to the machine, like
 * the theme and the row-title setting beside it in contexts/theme-context.tsx.
 *
 * This decides what is DRAWN and nothing else. A reminder already on a task
 * stays on it and still fires; delivery never reads this.
 */
export const SHOW_TASK_REMINDERS_STORAGE_KEY = 'astrid-show-task-reminders'

export const DEFAULT_SHOW_TASK_REMINDERS = false

/** A stored value. Anything but an explicit opt-in is the default, off. */
export function parseShowTaskReminders(value: string | null | undefined): boolean {
  return value === 'true' ? true : DEFAULT_SHOW_TASK_REMINDERS
}
