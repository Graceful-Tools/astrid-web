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
