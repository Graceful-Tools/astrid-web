/**
 * Task State Change Tracker
 *
 * Tracks changes to task state and generates human-readable descriptions
 * for display in task comment feeds.
 */

import { Task } from '@prisma/client'
import { format } from 'date-fns'

// Minimal types for what we need to track state changes
export interface MinimalAssignee {
  id: string
  name: string | null
  email?: string
}

export interface MinimalList {
  id: string
  name: string
}

export interface TaskWithRelations extends Task {
  assignee?: MinimalAssignee | null
  lists?: MinimalList[]
}

export interface StateChange {
  field: string
  description: string
}

/**
 * Compare old and new task states and generate change descriptions
 */
export function detectTaskStateChanges(
  oldTask: TaskWithRelations,
  newTask: TaskWithRelations,
  updaterName: string
): StateChange[] {
  const changes: StateChange[] = []

  // Track title changes
  if (oldTask.title !== newTask.title) {
    changes.push({
      field: 'title',
      description: `changed task name from "${oldTask.title}" to "${newTask.title}"`
    })
  }

  // Track description changes
  if (oldTask.description !== newTask.description) {
    const oldDesc = oldTask.description || '(empty)'
    const newDesc = newTask.description || '(empty)'
    changes.push({
      field: 'description',
      description: `changed description from "${truncate(oldDesc, 50)}" to "${truncate(newDesc, 50)}"`
    })
  }

  // Track priority changes
  if (oldTask.priority !== newTask.priority) {
    const oldPriorityText = formatPriority(oldTask.priority)
    const newPriorityText = formatPriority(newTask.priority)
    changes.push({
      field: 'priority',
      description: `changed priority from ${oldPriorityText} to ${newPriorityText}`
    })
  }

  // Track due date and time changes intelligently
  const oldDueDateTime = oldTask.dueDateTime
  const newDueDateTime = newTask.dueDateTime

  const dueTimeChanged = oldDueDateTime?.getTime() !== newDueDateTime?.getTime()

  // Determine if this is a date-only change, time-only change, or both
  if (dueTimeChanged) {
    // Check if only the date changed (compare dates, ignoring time)
    const oldDate = oldDueDateTime ? format(oldDueDateTime, 'yyyy-MM-dd') : null
    const newDate = newDueDateTime ? format(newDueDateTime, 'yyyy-MM-dd') : null
    const dateChanged = oldDate !== newDate

    // Check if only the time changed (compare times, assuming same date)
    const oldTime = oldDueDateTime ? format(oldDueDateTime, 'HH:mm') : null
    const newTime = newDueDateTime ? format(newDueDateTime, 'HH:mm') : null
    const timeChanged = oldTime !== newTime

    if (dateChanged && !timeChanged) {
      // Only date changed
      const oldDateText = oldDate ? format(new Date(oldDate), 'MMM d, yyyy') : 'no date set'
      const newDateText = newDate ? format(new Date(newDate), 'MMM d, yyyy') : 'no date set'
      changes.push({
        field: 'dueDateTime',
        description: `changed due date from ${oldDateText} to ${newDateText}`
      })
    } else if (timeChanged && !dateChanged) {
      // Only time changed
      const oldTimeText = oldTime ? format(new Date(`2000-01-01T${oldTime}`), 'h:mm a') : 'no time set'
      const newTimeText = newTime ? format(new Date(`2000-01-01T${newTime}`), 'h:mm a') : 'no time set'
      changes.push({
        field: 'dueDateTime',
        description: `changed due time from ${oldTimeText} to ${newTimeText}`
      })
    } else if (dateChanged && timeChanged) {
      // Both date and time changed - report both
      const oldDateText = oldDate ? format(new Date(oldDate), 'MMM d, yyyy') : 'no date set'
      const newDateText = newDate ? format(new Date(newDate), 'MMM d, yyyy') : 'no date set'
      changes.push({
        field: 'dueDateTime',
        description: `changed due date from ${oldDateText} to ${newDateText}`
      })

      if (oldTime || newTime) {
        const oldTimeText = oldTime ? format(new Date(`2000-01-01T${oldTime}`), 'h:mm a') : 'no time set'
        const newTimeText = newTime ? format(new Date(`2000-01-01T${newTime}`), 'h:mm a') : 'no time set'
        changes.push({
          field: 'dueDateTime',
          description: `changed due time from ${oldTimeText} to ${newTimeText}`
        })
      }
    }
  }

  // Track repeat setting changes
  if (oldTask.repeating !== newTask.repeating) {
    const oldRepeatText = formatRepeating(oldTask.repeating)
    const newRepeatText = formatRepeating(newTask.repeating)
    changes.push({
      field: 'repeating',
      description: `changed repeat setting from "${oldRepeatText}" to "${newRepeatText}"`
    })
  }

  // Track custom repeating data changes (when repeating is 'custom')
  if (newTask.repeating === 'custom' || oldTask.repeating === 'custom') {
    const oldData = oldTask.repeatingData as Record<string, unknown> | null
    const newData = newTask.repeatingData as Record<string, unknown> | null
    const oldDataStr = JSON.stringify(oldData)
    const newDataStr = JSON.stringify(newData)

    if (oldDataStr !== newDataStr && oldTask.repeating === 'custom' && newTask.repeating === 'custom') {
      // Custom pattern was modified (not just switched to/from custom)
      const description = formatCustomRepeatChange(oldData, newData)
      if (description) {
        changes.push({
          field: 'repeatingData',
          description
        })
      }
    }
  }

  // Track repeatFrom changes
  if (oldTask.repeatFrom !== newTask.repeatFrom && newTask.repeating !== 'never') {
    const oldMode = oldTask.repeatFrom === 'DUE_DATE' ? 'due date' : 'completion date'
    const newMode = newTask.repeatFrom === 'DUE_DATE' ? 'due date' : 'completion date'
    changes.push({
      field: 'repeatFrom',
      description: `changed repeat mode from ${oldMode} to ${newMode}`
    })
  }

  // Track assignee changes. Absent and null both mean "nobody": a row read
  // without the column must not turn a no-op into "from Unassigned to
  // Unassigned" (AWTD-1619).
  if ((oldTask.assigneeId ?? null) !== (newTask.assigneeId ?? null)) {
    const oldAssigneeText = oldTask.assignee?.name || 'Unassigned'
    const newAssigneeText = newTask.assignee?.name || 'Unassigned'
    changes.push({
      field: 'assigneeId',
      description: `reassigned from ${oldAssigneeText} to ${newAssigneeText}`
    })
  }

  // Track completion status changes
  if (oldTask.completed !== newTask.completed) {
    if (newTask.completed) {
      changes.push({
        field: 'completed',
        description: 'marked this as complete'
      })
    } else {
      changes.push({
        field: 'completed',
        description: 'marked this as incomplete'
      })
    }
  }

  // Track list changes (added/removed)
  const oldListIds = new Set(oldTask.lists?.map(l => l.id) || [])
  const newListIds = new Set(newTask.lists?.map(l => l.id) || [])

  // Find added lists
  newTask.lists?.forEach(list => {
    if (!oldListIds.has(list.id)) {
      changes.push({
        field: 'lists',
        description: `added this to list "${list.name}"`
      })
    }
  })

  // Find removed lists
  oldTask.lists?.forEach(list => {
    if (!newListIds.has(list.id)) {
      changes.push({
        field: 'lists',
        description: `removed this from list "${list.name}"`
      })
    }
  })

  return changes
}

/**
 * Format priority as visual representation
 */
function formatPriority(priority: number): string {
  switch (priority) {
    case 0:
      return 'none'
    case 1:
      return '!'
    case 2:
      return '!!'
    case 3:
      return '!!!'
    default:
      return priority.toString()
  }
}

/**
 * Format repeating setting as human-readable text
 */
function formatRepeating(repeating: string): string {
  switch (repeating) {
    case 'never':
      return 'Never'
    case 'daily':
      return 'Daily'
    case 'weekly':
      return 'Weekly'
    case 'monthly':
      return 'Monthly'
    case 'yearly':
      return 'Yearly'
    case 'custom':
      return 'Custom'
    default:
      return repeating
  }
}

/**
 * Format custom repeat pattern change as human-readable text
 */
function formatCustomRepeatChange(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null
): string | null {
  if (!newData) return null

  const interval = newData.interval as number || 1
  const unit = newData.unit as string || 'days'

  let description = `updated custom repeat to every ${interval} ${unit}`

  // Add weekday info for weekly
  if (unit === 'weeks' && newData.weekdays) {
    const weekdays = newData.weekdays as string[]
    if (weekdays.length > 0) {
      description += ` on ${weekdays.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}`
    }
  }

  // Add end condition info
  const endCondition = newData.endCondition as string
  if (endCondition === 'after_occurrences') {
    const count = newData.endAfterOccurrences as number
    description += ` (${count} times)`
  } else if (endCondition === 'until_date' && newData.endUntilDate) {
    description += ` (until ${format(new Date(newData.endUntilDate as string), 'MMM d, yyyy')})`
  }

  return description
}

/**
 * Format state changes into a human-readable comment
 * For system comments, uses inline format with "and" between changes
 */
export function formatStateChangesAsComment(
  changes: StateChange[],
  updaterName: string
): string {
  if (changes.length === 0) {
    return ''
  }

  // Simplify descriptions to reduce verbosity
  const simplifiedChanges = changes.map(c => ({
    ...c,
    description: simplifyDescription(c.description)
  }))

  if (simplifiedChanges.length === 1) {
    // Single change: "Jon Paris changed priority from ! to !!"
    return `${updaterName} ${simplifiedChanges[0].description}`
  }

  // Multiple changes: use natural language with commas and "and"
  // Example: "Jon Paris changed priority from ! to !!, due time from 9 AM to 5 PM, and repeat setting from Never to Daily"
  const descriptions = simplifiedChanges.map(c => c.description)
  const lastDescription = descriptions[descriptions.length - 1]
  const otherDescriptions = descriptions.slice(0, -1)

  if (otherDescriptions.length === 0) {
    return `${updaterName} ${lastDescription}`
  }

  return `${updaterName} ${otherDescriptions.join(', ')}, and ${lastDescription}`
}

/**
 * Simplify description to reduce verbosity while maintaining clarity
 */
function simplifyDescription(description: string): string {
  return description
    // Remove :00 from times (9:00 AM → 9 AM, 5:00 PM → 5 PM)
    .replace(/(\d+):00\s+(AM|PM)/g, '$1 $2')
    // Shorten month names in dates (November → Nov, December → Dec, etc.)
    .replace(/January/g, 'Jan')
    .replace(/February/g, 'Feb')
    .replace(/March/g, 'Mar')
    .replace(/April/g, 'Apr')
    .replace(/May/g, 'May')
    .replace(/June/g, 'Jun')
    .replace(/July/g, 'Jul')
    .replace(/August/g, 'Aug')
    .replace(/September/g, 'Sep')
    .replace(/October/g, 'Oct')
    .replace(/November/g, 'Nov')
    .replace(/December/g, 'Dec')
}

/**
 * Capitalize first letter of string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Truncate string to maxLength and add ellipsis if needed
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength) + '...'
}
