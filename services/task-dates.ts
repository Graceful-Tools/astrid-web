/**
 * Parsing a task date from a request body.
 *
 * Moved out of services/task.service.ts to make room under the
 * oversized-files ratchet (task 9377bc2c) for create-time completion fields
 * (AWTD-1123). Both the create and the update verbs read it.
 */

/** Parse a date field that may arrive as a string, a Date, or nothing. */
export function parseTaskDate(value: string | Date | null | undefined): {
  value: Date | null
  invalid: boolean
} {
  if (!value) return { value: null, invalid: false }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { value: null, invalid: true } : { value, invalid: false }
  }
  const parsed = new Date(value)
  return isNaN(parsed.getTime()) ? { value: null, invalid: true } : { value: parsed, invalid: false }
}

/**
 * The create path's date fields, validated and normalised (AWTD-1218).
 *
 * Three parse-and-400 blocks and the all-day normalisation, lifted out of
 * `createTaskWithSideEffects` whole. It is the same `{ ok: false, status, error }`
 * shape its neighbours `resolveCreateCompletionFields` and
 * `resolveStatusRoleWrite` use, so the caller stays three lines.
 *
 * **Why it moved.** `services/task.service.ts` sat at exactly 1,484 lines, its
 * recorded budget in `tests/rules/oversized-files-ratchet.test.ts`, and giving
 * `resolveStatusRoleWrite` a refusal cost two more. The ratchet is explicit:
 * *"Take the next piece out of the file rather than raising the number here.
 * 'Just a bit more' each time is how they reached these sizes."* So this is that
 * piece, and the budget goes DOWN with it rather than up.
 *
 * Dates were the cleanest seam available: self-contained, already returning the
 * 400 shape, and reading nothing but its own argument — no database, no actor,
 * no lists.
 */

export interface TaskDateInput {
  dueDateTime?: string | Date | null
  /** The legacy all-day field. `'none'` means "clear it", not a date. */
  when?: string | Date | null
  reminderTime?: string | Date | null
  isAllDay?: boolean
}

export interface ResolvedTaskDates {
  dueDateTime: Date | null
  isAllDay: boolean
  reminderTime: Date | null
}

export type TaskDatesResult =
  | { ok: true; data: ResolvedTaskDates }
  | { ok: false; status: 400; error: string }

export function resolveCreateDateFields(input: TaskDateInput): TaskDatesResult {
  const parsedDue = parseTaskDate(input.dueDateTime)
  if (parsedDue.invalid) {
    return { ok: false, status: 400, error: `Invalid dueDateTime format: ${String(input.dueDateTime)}` }
  }
  const parsedWhen = parseTaskDate(input.when === 'none' ? null : input.when)
  if (parsedWhen.invalid) {
    return { ok: false, status: 400, error: `Invalid date format: ${String(input.when)}` }
  }
  const parsedReminder = parseTaskDate(input.reminderTime)
  if (parsedReminder.invalid) {
    return { ok: false, status: 400, error: `Invalid reminderTime format: ${String(input.reminderTime)}` }
  }

  let dueDateTime = parsedDue.value ?? parsedWhen.value
  // `when` has always meant an all-day date; an explicit isAllDay wins over it.
  const isAllDay = input.isAllDay ?? (parsedWhen.value !== null && parsedDue.value === null)
  if (isAllDay && dueDateTime) {
    // v1's normalisation, applied everywhere. An "all day" task carrying a
    // stray time component renders on different days for two clients in
    // different zones, which is the one thing all-day is supposed to prevent.
    dueDateTime = new Date(dueDateTime)
    dueDateTime.setUTCHours(0, 0, 0, 0)
  }

  return { ok: true, data: { dueDateTime, isAllDay, reminderTime: parsedReminder.value } }
}
