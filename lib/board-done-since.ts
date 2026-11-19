/**
 * The Done column's period (ADEV-133, web half of ADEV-131 — iOS and Mac ship
 * the same rules): the header reads "Done · 15 ✓ This week", and the period
 * filters the Done cards as well as the count, on top of the Done set core draws.
 *
 * - A card's time is `completedAt`, else `updatedAt` (lib/board-done-column.ts).
 * - Presets roll with the clock; a picked date stays fixed, from the start of
 *   that local day. The week is Monday–Sunday whatever the locale.
 * - Saved per user and per list on the client; the default is This week.
 *
 * Pure and client-safe (storage helpers take the string, never touch `window`).
 */
import { doneCompletionDate } from '@/lib/board-done-column'

export type DoneSince =
  | { kind: 'today' }
  | { kind: 'this_week' }
  | { kind: 'this_month' }
  | { kind: 'this_year' }
  | { kind: 'date'; date: string }
  | { kind: 'all_time' }

export const DEFAULT_DONE_SINCE: DoneSince = { kind: 'this_week' }

/** The presets the menu offers, in order (Pick a date… and All time follow them). */
export const DONE_SINCE_PRESETS: readonly DoneSince[] = [
  { kind: 'today' },
  { kind: 'this_week' },
  { kind: 'this_month' },
  { kind: 'this_year' },
]

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** "YYYY-MM-DD" → that local day's midnight, or null when it is not a real day. */
export function parseDoneSinceDay(value: string): Date | null {
  const match = DAY.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  const date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null
}

/** The "YYYY-MM-DD" a picked date is stored as. */
export function doneSinceDayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The earliest moment a Done card may carry, or null for All time. */
export function doneSinceCutoff(since: DoneSince, now: Date = new Date()): Date | null {
  switch (since.kind) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    case 'this_week': {
      const sinceMonday = (now.getDay() + 6) % 7
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday)
    }
    case 'this_month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
    case 'this_year':
      return new Date(now.getFullYear(), 0, 1)
    case 'date':
      return parseDoneSinceDay(since.date)
    case 'all_time':
      return null
  }
}

/** Done cards at or after the period's start. A card with no date at all is dropped, except for All time. */
export function filterDoneSince<T extends { completedAt?: Date | string | null; updatedAt?: Date | string | null }>(
  tasks: readonly T[],
  since: DoneSince,
  now: Date = new Date(),
): T[] {
  const cutoff = doneSinceCutoff(since, now)
  if (!cutoff) return [...tasks]
  return tasks.filter(task => {
    const date = doneCompletionDate(task)
    return date !== null && date.getTime() >= cutoff.getTime()
  })
}

export function doneSinceStorageKey(userId: string | null | undefined, listId: string): string {
  return `astrid.board.doneSince.${userId ?? 'anonymous'}.${listId}`
}

export function parseDoneSince(raw: string | null | undefined): DoneSince {
  if (!raw) return DEFAULT_DONE_SINCE
  try {
    const value = JSON.parse(raw) as { kind?: unknown; date?: unknown }
    switch (value.kind) {
      case 'today':
      case 'this_week':
      case 'this_month':
      case 'this_year':
      case 'all_time':
        return { kind: value.kind }
      case 'date':
        return typeof value.date === 'string' && parseDoneSinceDay(value.date)
          ? { kind: 'date', date: value.date }
          : DEFAULT_DONE_SINCE
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_DONE_SINCE
}

/** The i18n key of a period's label; "since {date}" takes the date as a parameter. */
export function formatDoneSinceLabelKey(since: DoneSince): string {
  switch (since.kind) {
    case 'today':
      return 'time.today'
    case 'this_week':
      return 'time.thisWeek'
    case 'this_month':
      return 'time.thisMonth'
    case 'this_year':
      return 'board.doneSince.thisYear'
    case 'date':
      return 'board.doneSince.sinceDate'
    case 'all_time':
      return 'board.doneSince.allTime'
  }
}
