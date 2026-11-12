import type { Task } from "@/types/task"
import {
  isSameDay,
  isBeforeDay,
  isWithinDayRange,
} from "./date-comparison"

/**
 * Date Filter Utilities - Google Calendar Specification
 *
 * These utilities implement Google Calendar's approach to date handling:
 * - All-day events: Use date-only comparison (timezone-independent)
 * - Timed events: Use full timestamp comparison (timezone-aware)
 *
 * Uses shared utilities from date-comparison.ts for core comparisons.
 *
 * References:
 * - https://developers.google.com/calendar/api/concepts/events-calendars
 * - RFC 5545 (iCalendar specification)
 */

/**
 * Check if a task is due today
 *
 * All-day tasks: Compares UTC date components (year/month/day)
 * Timed tasks: Compares local timezone date components
 *
 * @param task - The task to check
 * @returns true if task is due today, false otherwise
 */
export function isTaskDueToday(task: Task): boolean {
  if (!task.dueDateTime) return false

  const dueDate = new Date(task.dueDateTime)
  const now = new Date()

  return isSameDay(dueDate, now, task.isAllDay)
}

/**
 * Check if a task is overdue: its DAY has passed (AWTD-1583, astrid-core D34).
 *
 * All-day tasks: Due date (UTC) is before today (local)
 * Timed tasks: Due day (local) is before today (local) — a task due at 9am is due today all day
 * and overdue from local midnight, as on iOS and in the core (`filters::matches_due_date`). It
 * compared instants until AWTD-1583, which made a task due today overdue at its time on web only.
 *
 * @param task - The task to check
 * @returns true if task is overdue, false otherwise
 */
export function isTaskOverdue(task: Task): boolean {
  if (!task.dueDateTime) return false

  return isBeforeDay(new Date(task.dueDateTime), new Date(), task.isAllDay)
}

/**
 * Check if a task is due this week (next 7 days from today)
 *
 * @param task - The task to check
 * @returns true if task is due within next 7 days, false otherwise
 */
export function isTaskDueThisWeek(task: Task): boolean {
  if (!task.dueDateTime) return false

  const dueDate = new Date(task.dueDateTime)
  const now = new Date()
  const weekFromNow = new Date(now)
  weekFromNow.setDate(now.getDate() + 7)

  return isWithinDayRange(dueDate, now, weekFromNow, task.isAllDay)
}

/**
 * Check if a task is due this month (next 30 days from today)
 *
 * @param task - The task to check
 * @returns true if task is due within next 30 days, false otherwise
 */
export function isTaskDueThisMonth(task: Task): boolean {
  if (!task.dueDateTime) return false

  const dueDate = new Date(task.dueDateTime)
  const now = new Date()
  const monthFromNow = new Date(now)
  monthFromNow.setDate(now.getDate() + 30)

  return isWithinDayRange(dueDate, now, monthFromNow, task.isAllDay)
}

/**
 * The due-date windows every client reads (astrid-core `filters::matches_due_date`). Web also had
 * `tomorrow`, `this_calendar_week` and `this_calendar_month`; no other client read them, and they
 * were retired in AWTD-1583 (astrid-core D35). Values saved before then still exist in saved
 * filters and My Tasks preferences — {@link coreDueDateWindow} reads them as the nearest of these.
 */
export const DUE_DATE_WINDOWS = ['all', 'overdue', 'today', 'this_week', 'this_month', 'no_date'] as const
export type DueDateWindow = (typeof DUE_DATE_WINDOWS)[number]

const RETIRED_DUE_DATE_WINDOWS: Readonly<Record<string, DueDateWindow>> = {
  // The smallest window every client reads that still holds the retired one.
  tomorrow: 'this_week',
  this_calendar_week: 'this_week',
  this_calendar_month: 'this_month',
}

/**
 * A saved due-date filter value, as a window every client reads (AWTD-1583).
 *
 * Applied where a STORED value is read (saved filters, My Tasks preferences), not inside
 * {@link applyDateFilter}: that function answers exactly as the core does, where a retired value
 * is just an unknown one. A user whose saved filter said "Tomorrow" sees the next 7 days rather
 * than every dated task. Anything else passes through unchanged.
 */
export function coreDueDateWindow(value: string): string
export function coreDueDateWindow(value: string | null | undefined): string | null | undefined
export function coreDueDateWindow(value: string | null | undefined): string | null | undefined {
  return (value && RETIRED_DUE_DATE_WINDOWS[value]) || value
}

/**
 * Generic date filter function, answering as astrid-core's `filters::matches_due_date` does
 * (AWTD-1583: D7, D34, D35).
 *
 * - An undated task is answered before the filter is examined: it matches `no_date` and nothing
 *   else, so an unrecognised value keeps dated tasks and hides undated ones (D7).
 * - Overdue means the due DAY has passed (D34), and only for an open task.
 * - Overdue open tasks surface in every forward-looking window.
 *
 * @param task - The task to check
 * @param filterType - The filter type to apply
 * @returns true if task matches filter, false otherwise
 */
export function applyDateFilter(task: Task, filterType: string): boolean {
  if (filterType === "all") return true
  if (!task.dueDateTime) return filterType === "no_date"
  if (filterType === "no_date") return false

  const isOverdueIncomplete = isTaskOverdue(task) && !task.completed

  switch (filterType) {
    case "overdue":
      return isOverdueIncomplete
    case "today":
      return isTaskDueToday(task) || isOverdueIncomplete
    case "this_week":
      return isTaskDueThisWeek(task) || isOverdueIncomplete
    case "this_month":
      return isTaskDueThisMonth(task) || isOverdueIncomplete
    default:
      return true
  }
}
