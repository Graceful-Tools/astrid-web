/**
 * Repeating Task Handler
 *
 * Handles the logic for rolling forward repeating tasks when they are completed.
 * Implements both "Repeat from due date" and "Repeat from completion date" modes.
 *
 * Spec:
 * - Repeat from due date: Next occurrence is based on the original due date, regardless of when completed
 * - Repeat from completion date: Next occurrence is based on when the task was actually completed
 * - Default mode: COMPLETION_DATE (per spec requirement)
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { RepeatFromMode } from '@/types/task'
import type { CustomRepeatingPattern, SimplePatternEndCondition } from '@/types/repeating'
import { calculateNextOccurrence, calculateSimpleRepeatingNextOccurrence, checkSimplePatternEndCondition } from '@/types/repeating'
import { createLogger } from '@/lib/logger'

const log = createLogger('repeating-task-handler')


export interface RepeatingTaskResult {
  shouldRollForward: boolean
  shouldTerminate: boolean
  nextDueDate: Date | null
  newOccurrenceCount: number
}

/**
 * Handle repeating task completion
 *
 * When a repeating task is marked as completed:
 * 1. Calculate the next due date based on the repeat mode (DUE_DATE vs COMPLETION_DATE)
 * 2. Check if the series should terminate (occurrence count or until date reached)
 * 3. If not terminating, roll the task forward (clear completed flag, update due date, increment occurrence count)
 * 4. If terminating, clear the repeating configuration
 *
 * @param taskId - ID of the task being completed
 * @param wasCompleted - Previous completion status (to detect completion toggle)
 * @param isNowCompleted - New completion status
 * @returns Result indicating whether to roll forward and the new state
 */
export async function handleRepeatingTaskCompletion(
  taskId: string,
  wasCompleted: boolean,
  isNowCompleted: boolean,
  localCompletionDate?: string // YYYY-MM-DD format from client's local timezone
): Promise<RepeatingTaskResult | null> {
  // Only process when task is being marked as complete (not un-complete)
  if (!isNowCompleted || wasCompleted) {
    return null
  }

  // Get the task with its current state
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      repeating: true,
      repeatingData: true,
      repeatFrom: true,
      occurrenceCount: true,
      dueDateTime: true,
      isAllDay: true,
    }
  })

  if (!task) {
    return null
  }

  // Only process repeating tasks (not "never")
  if (task.repeating === 'never') {
    return null
  }

  // Determine completion date
  // For all-day tasks with COMPLETION_DATE mode, use the client's local date if provided
  // This fixes the bug where completing at 9pm PST (= 5am UTC next day) would use the wrong date
  let completionDate: Date
  if (task.isAllDay && localCompletionDate && task.repeatFrom !== 'DUE_DATE') {
    // Parse the local date string and set to UTC midnight
    // e.g., "2026-01-05" -> 2026-01-05T00:00:00.000Z
    const [year, month, day] = localCompletionDate.split('-').map(Number)
    completionDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  } else {
    completionDate = new Date()
  }
  // Use dueDateTime for time reference
  const timeReference = task.dueDateTime
  const currentDueDate = task.dueDateTime
  const currentOccurrenceCount = task.occurrenceCount || 0
  const repeatFrom: RepeatFromMode = task.repeatFrom as RepeatFromMode || 'COMPLETION_DATE'

  // Handle custom repeating patterns
  if (task.repeating === 'custom' && task.repeatingData) {
    const pattern = task.repeatingData as unknown as CustomRepeatingPattern

    const result = calculateNextOccurrence(
      pattern,
      timeReference,
      completionDate,
      repeatFrom,
      currentOccurrenceCount
    )

    return {
      shouldRollForward: !result.shouldTerminate,
      shouldTerminate: result.shouldTerminate,
      nextDueDate: result.nextDueDate,
      newOccurrenceCount: result.newOccurrenceCount
    }
  }

  // Handle simple repeating patterns (daily, weekly, monthly, yearly)
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(task.repeating)) {
    const nextDueDate = calculateSimpleRepeatingNextOccurrence(
      task.repeating as "daily" | "weekly" | "monthly" | "yearly",
      timeReference,
      completionDate,
      repeatFrom
    )

    // Increment occurrence count
    const newOccurrenceCount = currentOccurrenceCount + 1

    // Check for end conditions in repeatingData
    // Simple patterns can optionally have end conditions stored in repeatingData
    let endData: SimplePatternEndCondition | null = null
    if (task.repeatingData) {
      try {
        const data = task.repeatingData as any
        if (data && typeof data === 'object' && data.endCondition) {
          endData = {
            endCondition: data.endCondition,
            endAfterOccurrences: data.endAfterOccurrences,
            endUntilDate: data.endUntilDate ? new Date(data.endUntilDate) : undefined
          }
        }
      } catch (e) {
        log.warn({ e }, 'Failed to parse end condition data for simple pattern:')
        // If parsing fails, continue without end conditions
        endData = null
      }
    }

    // Check if pattern should terminate
    const endResult = checkSimplePatternEndCondition(nextDueDate, newOccurrenceCount, endData)

    return {
      shouldRollForward: !endResult.shouldTerminate,
      shouldTerminate: endResult.shouldTerminate,
      nextDueDate: endResult.shouldTerminate ? null : nextDueDate,
      newOccurrenceCount: endResult.newOccurrenceCount
    }
  }

  return null
}

/**
 * Apply the repeating task roll-forward to the database
 *
 * This updates the task to roll it forward to the next occurrence:
 * - Clears the completed flag
 * - Updates the due date
 * - Increments the occurrence count
 * - OR clears the repeating config if series terminated
 *
 * @param taskId - ID of the task to update
 * @param result - Result from handleRepeatingTaskCompletion
 */
export async function applyRepeatingTaskRollForward(
  taskId: string,
  result: RepeatingTaskResult
): Promise<void> {
  if (result.shouldTerminate) {
    // Series has ended - clear repeating config and keep task completed
    await prisma.task.update({
      where: { id: taskId },
      data: {
        repeating: 'never',
        repeatingData: Prisma.DbNull,  // Use Prisma.DbNull to clear the JSON field
        // Note: repeatFrom cannot be null per schema, keep existing value
        occurrenceCount: result.newOccurrenceCount
      }
    })
  } else if (result.shouldRollForward && result.nextDueDate) {
    // Roll forward to next occurrence
    await prisma.task.update({
      where: { id: taskId },
      data: {
        completed: false,
        dueDateTime: result.nextDueDate,
        occurrenceCount: result.newOccurrenceCount,
        reminderSent: false, // Reset reminder flag for next occurrence
      }
    })
  }
}
