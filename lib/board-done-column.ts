/**
 * The board's Done column (Jon, 2026-11-19): the most recently completed card on
 * top, and each card's completed date as a pill under its title.
 *
 * One spec for every client — iOS, Mac, web, Windows, Android — and astrid-core
 * (PR #93: Done sorted the same way, `completedOn: "YYYY-MM-DD"` on every row).
 * The browser board draws with its own TypeScript, so the rule lives here too:
 *
 * - **Order:** by `completedAt`, falling back to `updatedAt`; newest first; ties
 *   keep their incoming order. The list's manual order / sort does not apply to
 *   Done. Other columns are untouched.
 * - **Pill:** the local calendar day of that same date, as the locale's short
 *   month and day ("Nov 19"), with the year only when it is not this year
 *   ("Nov 19, 2025").
 *
 * Pure and client-safe.
 */
import { intlLocale } from '@/lib/i18n/date-format'

interface CompletionDates {
  completedAt?: Date | string | null
  updatedAt?: Date | string | null
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** When the task was completed: `completedAt`, else `updatedAt`, else null. */
export function doneCompletionDate(task: CompletionDates): Date | null {
  return toDate(task.completedAt) ?? toDate(task.updatedAt)
}

/**
 * Done-column order: newest completion first. Stable, so ties keep the order
 * they came in; a task with no date at all sinks to the bottom. Never mutates.
 */
export function sortDoneColumnTasks<T extends CompletionDates>(tasks: readonly T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index, time: doneCompletionDate(task)?.getTime() ?? null }))
    .sort((a, b) => {
      if (a.time === null || b.time === null) {
        if (a.time === b.time) return a.index - b.index
        return a.time === null ? 1 : -1
      }
      return b.time - a.time || a.index - b.index
    })
    .map(entry => entry.task)
}

/** The local calendar day, "YYYY-MM-DD" — the shape core's rows carry as `completedOn`. */
export function completedOnDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** "Nov 19" this year, "Nov 19, 2025" otherwise, in the reader's locale. */
export function formatCompletedOnLabel(date: Date, locale?: string | null, now: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric'
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date)
}
