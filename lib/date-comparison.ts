/**
 * Shared Date Comparison Utilities
 *
 * These utilities implement Google Calendar's approach to date handling:
 * - All-day events: Use date-only comparison (timezone-independent)
 * - Timed events: Use full timestamp comparison (timezone-aware)
 *
 * Key principle: All-day tasks are stored at UTC midnight and represent
 * a calendar date (not a moment in time). Timed tasks represent specific
 * moments in time and must respect timezone.
 */

/**
 * Get the local calendar date as a UTC midnight timestamp.
 *
 * CRITICAL: This uses LOCAL calendar date components (year/month/day)
 * to create a UTC timestamp at midnight.
 *
 * Example: 10 PM Jan 15 PT → Jan 15 00:00:00 UTC (not Jan 16)
 *
 * @param date - The date to convert (defaults to now)
 * @returns UTC timestamp at midnight for the local calendar date
 */
export function getLocalDateAsUTCMidnight(date: Date = new Date()): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * The all-day instant for a local calendar day: UTC midnight of that day.
 *
 * The write-side twin of getLocalDateAsUTCMidnight. Flattening with
 * `setUTCHours(0, 0, 0, 0)` instead reads the UTC day, which is the day
 * before east of UTC for a local midnight (AWTD-1270).
 */
export function allDayInstantForLocalDay(date: Date): Date {
  return new Date(getLocalDateAsUTCMidnight(date))
}

/**
 * A task's calendar day, as local midnight of that day.
 *
 * A timed task's day is its local day; an all-day task's day is its UTC day,
 * because that is how it is stored. Edits that keep "the task's day" (clearing
 * or picking a time) must start here rather than from the raw instant (AWTD-1270).
 */
export function taskCalendarDay(dueDateTime: Date, isAllDay: boolean): Date {
  return isAllDay
    ? new Date(dueDateTime.getUTCFullYear(), dueDateTime.getUTCMonth(), dueDateTime.getUTCDate())
    : new Date(dueDateTime.getFullYear(), dueDateTime.getMonth(), dueDateTime.getDate())
}

/**
 * Get the UTC calendar date as a UTC midnight timestamp.
 *
 * This extracts the UTC date components from a date stored at UTC midnight.
 * Use this for dates that are already stored in UTC (like all-day task due dates).
 *
 * @param date - The date to convert
 * @returns UTC timestamp at midnight for the UTC calendar date
 */
export function getUTCDateMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Calculate the difference in days between two dates.
 *
 * @param date - The target date
 * @param reference - The reference date (defaults to now)
 * @param isAllDay - Whether to use UTC comparison (for all-day events)
 * @returns Number of days difference (positive = future, negative = past)
 */
export function getDaysDifference(
  date: Date,
  reference: Date = new Date(),
  isAllDay: boolean = false
): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  if (isAllDay) {
    // All-day: Use UTC comparison
    const refUTC = getLocalDateAsUTCMidnight(reference)
    const dateUTC = getUTCDateMidnight(date)
    return Math.floor((dateUTC - refUTC) / MS_PER_DAY)
  } else {
    // Timed: Use local timezone comparison
    const refLocal = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
    const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    return Math.floor((dateLocal.getTime() - refLocal.getTime()) / MS_PER_DAY)
  }
}

/**
 * Check if two dates represent the same calendar day.
 *
 * @param date1 - First date
 * @param date2 - Second date
 * @param isAllDay - Whether to use UTC comparison (for all-day events)
 * @returns true if same day, false otherwise
 */
export function isSameDay(
  date1: Date,
  date2: Date,
  isAllDay: boolean = false
): boolean {
  if (isAllDay) {
    return getUTCDateMidnight(date1) === getLocalDateAsUTCMidnight(date2)
  } else {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    )
  }
}

/**
 * Check if a date is before another date (day comparison only).
 *
 * @param date - The date to check
 * @param reference - The reference date
 * @param isAllDay - Whether to use UTC comparison (for all-day events)
 * @returns true if date is before reference, false otherwise
 */
export function isBeforeDay(
  date: Date,
  reference: Date,
  isAllDay: boolean = false
): boolean {
  if (isAllDay) {
    return getUTCDateMidnight(date) < getLocalDateAsUTCMidnight(reference)
  } else {
    const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const refLocal = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
    return dateLocal < refLocal
  }
}

/**
 * Check if a date falls within a range (day comparison only).
 *
 * @param date - The date to check
 * @param start - Start of range (inclusive)
 * @param end - End of range (inclusive)
 * @param isAllDay - Whether to use UTC comparison (for all-day events)
 * @returns true if date is within range, false otherwise
 */
export function isWithinDayRange(
  date: Date,
  start: Date,
  end: Date,
  isAllDay: boolean = false
): boolean {
  if (isAllDay) {
    const dateUTC = getUTCDateMidnight(date)
    const startUTC = getLocalDateAsUTCMidnight(start)
    const endUTC = getLocalDateAsUTCMidnight(end)
    return dateUTC >= startUTC && dateUTC <= endUTC
  } else {
    const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const startLocal = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endLocal = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    return dateLocal >= startLocal && dateLocal <= endLocal
  }
}
