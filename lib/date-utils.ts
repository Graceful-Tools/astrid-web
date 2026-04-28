import { getDaysDifference } from "./date-comparison"
import { createLogger } from '@/lib/logger'

const log = createLogger('date-utils')


/**
 * Convert relative date strings to actual Date objects
 * Handles strings like "tomorrow", "next week", "monday", etc.
 *
 * IMPORTANT: Returns dates at midnight (00:00:00) by default.
 * Time should be applied separately via defaultDueTime if needed.
 */
export function parseRelativeDate(dateString: string | null | undefined): Date | null {
  if (!dateString || dateString === "none") {
    return null
  }

  const today = new Date()
  const lowerDateString = dateString.toLowerCase().trim()

  switch (lowerDateString) {
    case "today":
      // Use exact same pattern as calendar picker (task-form.tsx line 133)
      return today

    case "tomorrow":
      // Use exact same pattern as calendar picker (task-form.tsx line 136-138)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      return tomorrow

    case "next week":
    case "next_week":
      // Use exact same pattern as calendar picker (task-form.tsx line 141-143)
      const nextWeek = new Date(today)
      nextWeek.setDate(nextWeek.getDate() + 7)
      return nextWeek

    case "this week":
    case "this_week":
      // Set to Friday of this week
      const daysUntilFriday = (5 - today.getDay() + 7) % 7
      const thisWeek = new Date()
      thisWeek.setDate(today.getDate() + daysUntilFriday)
      thisWeek.setHours(0, 0, 0, 0) // Strip time - set to midnight
      return thisWeek
    
    case "monday":
    case "mon":
      return getNextWeekday(1)
    
    case "tuesday":
    case "tue":
      return getNextWeekday(2)
    
    case "wednesday":
    case "wed":
      return getNextWeekday(3)
    
    case "thursday":
    case "thu":
      return getNextWeekday(4)
    
    case "friday":
    case "fri":
      return getNextWeekday(5)
    
    case "saturday":
    case "sat":
      return getNextWeekday(6)
    
    case "sunday":
    case "sun":
      return getNextWeekday(0)
    
    default:
      // Try to parse as a regular date string
      const parsedDate = new Date(dateString)
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate
      }
      
      log.warn(`Unknown relative date format: ${dateString}`)
      return null
  }
}

/**
 * Get the next occurrence of a specific weekday
 * targetDay: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
 * Returns date at midnight (00:00:00)
 */
function getNextWeekday(targetDay: number): Date {
  const today = new Date()
  const currentDay = today.getDay()

  let daysUntilTarget = targetDay - currentDay
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7
  }

  const targetDate = new Date()
  targetDate.setDate(today.getDate() + daysUntilTarget)
  targetDate.setHours(0, 0, 0, 0) // Strip time - set to midnight

  return targetDate
}

/**
 * Convert a Date object to a user-friendly string
 * @param date - The date to format
 * @param isAllDay - Whether this is an all-day task (affects timezone handling)
 */
export function formatDateForDisplay(date: Date | null, isAllDay: boolean = false): string {
  if (!date) return "No due date"

  const daysDiff = getDaysDifference(date, new Date(), isAllDay)

  if (daysDiff === 0) {
    return "Today"
  } else if (daysDiff === 1) {
    return "Tomorrow"
  } else if (daysDiff === -1) {
    return "Yesterday"
  } else if (isAllDay) {
    // Format date in UTC for all-day events
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const day = date.getUTCDate()
    return new Date(Date.UTC(year, month, day)).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } else {
    return date.toLocaleDateString()
  }
}
