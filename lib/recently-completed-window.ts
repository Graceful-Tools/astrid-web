/**
 * Per-list "Recently completed" window.
 *
 * Drives the default-mode completion filter in both list view and the
 * board's virtual Done column. One config, two surfaces, no drift.
 *
 * `null` (or `undefined`) means the default: a 24-hour rolling window
 * (preserves the legacy behavior from useFilterState's "default" branch).
 *
 * See docs/product/project-status-board.md for shipping status.
 */

export type RecentlyCompletedWindow =
  | { kind: 'duration'; amount: number; unit: 'hour' | 'day' | 'week' | 'month' }
  | { kind: 'since-weekday'; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 } // 0=Sun..6=Sat
  | { kind: 'since-day-of-month'; day: number }                  // 1..31
  | { kind: 'since-date'; date: string }                         // YYYY-MM-DD, local

export const DEFAULT_RECENTLY_COMPLETED_WINDOW: RecentlyCompletedWindow = {
  kind: 'duration',
  amount: 24,
  unit: 'hour',
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

function startOfLocalDay(date: Date): Date {
  const out = new Date(date)
  out.setHours(0, 0, 0, 0)
  return out
}

/**
 * Returns the cutoff Date for the window relative to `now`. A completed task
 * whose updatedAt is `>= cutoff` is "recently completed."
 *
 * The default (null/undefined window) resolves to `now - 24h`, matching the
 * pre-existing useFilterState "default" semantics.
 */
export function getRecentlyCompletedCutoff(
  window: RecentlyCompletedWindow | null | undefined,
  now: Date,
): Date {
  const w = window ?? DEFAULT_RECENTLY_COMPLETED_WINDOW

  switch (w.kind) {
    case 'duration': {
      const unitMs = w.unit === 'hour' ? HOUR_MS
        : w.unit === 'day' ? DAY_MS
        : w.unit === 'week' ? WEEK_MS
        : DAY_MS * 30 // 'month' = 30 days for our purposes (rolling, not anchored)
      return new Date(now.getTime() - w.amount * unitMs)
    }

    case 'since-weekday': {
      // "Most recent occurrence of this weekday, including today." When the
      // target is today, return today at 00:00 local. Otherwise walk back to
      // the most recent prior occurrence.
      const start = startOfLocalDay(now)
      const today = start.getDay()
      const delta = (today - w.weekday + 7) % 7
      start.setDate(start.getDate() - delta)
      return start
    }

    case 'since-day-of-month': {
      // "Most recent N-th day of a month, including today." If the day has
      // not yet occurred this month (e.g. now=May 11, day=20), roll back to
      // the previous month's N-th.
      const start = startOfLocalDay(now)
      const todayDom = start.getDate()
      if (todayDom >= w.day) {
        start.setDate(w.day)
      } else {
        start.setMonth(start.getMonth() - 1)
        start.setDate(w.day)
      }
      return start
    }

    case 'since-date': {
      // ISO YYYY-MM-DD interpreted at 00:00 local. Defensive parse: split on
      // '-' rather than `new Date('YYYY-MM-DD')` which parses as UTC.
      const [y, m, d] = w.date.split('-').map(Number)
      return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
    }
  }
}

export interface CompletableTask {
  completed: boolean
  updatedAt: Date | string | null | undefined
}

/**
 * True when the task is completed and was completed inside the configured
 * "recently completed" window. Used to gate the default-mode completion
 * filter in list view and the virtual Done column on the board.
 */
export function isTaskRecentlyCompleted(
  task: CompletableTask,
  window: RecentlyCompletedWindow | null | undefined,
  now: Date,
): boolean {
  if (!task.completed) return false
  if (!task.updatedAt) return false
  const updated = task.updatedAt instanceof Date ? task.updatedAt : new Date(task.updatedAt)
  if (Number.isNaN(updated.getTime())) return false
  const cutoff = getRecentlyCompletedCutoff(window, now)
  return updated.getTime() >= cutoff.getTime()
}

export type CompletionFilterMode = 'all' | 'completed' | 'incomplete' | 'default'

/**
 * Single source of truth for "should this task be visible under the list's
 * completion filter?". Used by:
 *   - list view (useFilterState's default-mode branch)
 *   - board view (the virtual Done column's task set)
 *
 * Modes:
 *   - "all"        → every task shows
 *   - "completed"  → only completed
 *   - "incomplete" → only incomplete
 *   - "default"    → incomplete tasks always show; completed tasks only show
 *                    when inside the per-list "Recently completed" window
 *                    (null window → legacy 24h)
 */
export function shouldShowCompletedByFilter(
  task: CompletableTask,
  mode: CompletionFilterMode,
  window: RecentlyCompletedWindow | null | undefined,
  now: Date,
): boolean {
  switch (mode) {
    case 'all':        return true
    case 'completed':  return task.completed
    case 'incomplete': return !task.completed
    case 'default':    return !task.completed || isTaskRecentlyCompleted(task, window, now)
  }
}
