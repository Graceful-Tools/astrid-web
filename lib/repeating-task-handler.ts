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
import { isKnownTimeZone } from '@/types/repeating'
import { nextOccurrenceForTask } from '@/lib/repeating-rollover'


export interface RepeatingTaskResult {
  shouldRollForward: boolean
  shouldTerminate: boolean
  nextDueDate: Date | null
  newOccurrenceCount: number
}

const SIMPLE_PATTERNS = new Set(['daily', 'weekly', 'monthly', 'yearly'])
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Handle repeating task completion
 *
 * When a repeating task is marked as completed:
 * 1. Calculate the next due date based on the repeat mode (DUE_DATE vs COMPLETION_DATE)
 * 2. Check if the series should terminate (occurrence count or until date reached)
 * 3. If not terminating, roll the task forward (clear completed flag, update due date, increment occurrence count)
 * 4. If terminating, clear the repeating configuration
 *
 * The arithmetic is astrid-core's `nextOccurrence` (lib/repeating-rollover.ts, AWTD-1063), the
 * rule iOS and the Mac run, with the TypeScript as the fail-safe. A TIMED task steps on the
 * person's calendar when the client says which zone they are in (`timeZone`). Without one it
 * steps on UTC's, as the server always did. An ALL-DAY task steps on UTC's calendar either way.
 *
 * @param taskId - ID of the task being completed
 * @param wasCompleted - Previous completion status (to detect completion toggle)
 * @param isNowCompleted - New completion status
 * @param localCompletionDate - YYYY-MM-DD, the client's own calendar day at completion
 * @param timeZone - the client's IANA zone (`America/Los_Angeles`); an unknown name reads as absent
 * @returns Result indicating whether to roll forward and the new state
 */
export async function handleRepeatingTaskCompletion(
  taskId: string,
  wasCompleted: boolean,
  isNowCompleted: boolean,
  localCompletionDate?: string,
  timeZone?: string | null,
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

  // Only a pattern the server can step rolls: a custom one with its pattern stored, or a simple
  // one. Anything else (never, custom with nothing stored) just completes.
  const steppable = (task.repeating === 'custom' && !!task.repeatingData) || SIMPLE_PATTERNS.has(task.repeating)
  if (!steppable) {
    return null
  }

  const repeatFrom: RepeatFromMode = (task.repeatFrom as RepeatFromMode) || 'COMPLETION_DATE'
  const zone = isKnownTimeZone(timeZone) ? timeZone : null

  // The instant the completion happened, and the zone whose calendar it is read on.
  //
  // An all-day task repeating from its completion anchors on the person's calendar DAY. The client
  // sends that day (`localCompletionDate`), which is right even when an offline completion reaches
  // the server a day later. It is sent as that day's UTC midnight, read in UTC. Without it, the
  // day is read off the server's clock in the person's zone (UTC when unknown). Completing at 9pm
  // in California is 5am UTC the next day, so that answer is only as good as the zone.
  let completion = new Date()
  let calendarZone = zone ?? 'UTC'
  const localDay = localCompletionDate ? LOCAL_DATE.exec(localCompletionDate) : null
  if (task.isAllDay && repeatFrom !== 'DUE_DATE' && localDay) {
    const [, year, month, day] = localDay.map(Number)
    completion = new Date(Date.UTC(year, month - 1, day))
    calendarZone = 'UTC'
  }

  const answer = nextOccurrenceForTask({
    repeating: task.repeating,
    pattern: task.repeatingData ?? null,
    currentDueDate: task.dueDateTime,
    completion,
    repeatFrom,
    occurrenceCount: task.occurrenceCount || 0,
    timeZone: calendarZone,
    isAllDay: task.isAllDay,
  })

  return {
    shouldRollForward: !answer.shouldTerminate,
    shouldTerminate: answer.shouldTerminate,
    nextDueDate: answer.nextDueDate === null ? null : new Date(answer.nextDueDate),
    newOccurrenceCount: answer.newOccurrenceCount,
  }
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
    // Series has ended - clear the repeating config. Completing the final
    // occurrence is the caller's ordinary completion path, not this write
    // (AWTD-1092: this branch used to be the only write, so it never completed).
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
