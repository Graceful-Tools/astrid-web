/**
 * Complete a task from somewhere that is not a user-facing write surface — an
 * agent webhook, the coding workflow, a system task, a sync engine (AWTD-1093).
 *
 * These callers used to write `completed: true` straight to the row, which
 * skipped everything completion means: the stamp and its provenance, clearing
 * the board lane, promoting the tasks it was blocking, rolling a repeating
 * series forward, cancelling reminders, events and SSE. Going through
 * `updateTaskWithSideEffects` makes them complete a task exactly the way a
 * person tapping the checkbox does.
 *
 * The caller has already decided the actor may do this; the service applies
 * the completion rules, not the caller's authorisation.
 */

import { updateTaskWithSideEffects, type UpdateTaskIntent, type UpdateTaskResult } from '@/services/task.service'

export interface CompleteTaskArgs {
  taskId: string
  /** Who completed it, for the activity history and the notification. */
  actorId: string
  actorName?: string
  actorType?: 'user' | 'agent'
  /** Where it was completed, when not here: 'github', 'google', … */
  completedSource?: string
  /** The provider's own completion time, when syncing. */
  completedAt?: Date | string
  closedReason?: string | null
  /** Any other fields the same write should carry (a sync updates title/body too). */
  alsoSet?: Omit<UpdateTaskIntent, 'completed' | 'completedAt' | 'completedSource' | 'closedReason'>
}

export function completeTask(args: CompleteTaskArgs): Promise<UpdateTaskResult> {
  const intent: UpdateTaskIntent = { ...args.alsoSet, completed: true }
  if (args.completedSource) intent.completedSource = args.completedSource
  if (args.completedAt) intent.completedAt = args.completedAt
  if (args.closedReason !== undefined) intent.closedReason = args.closedReason

  return updateTaskWithSideEffects({
    taskId: args.taskId,
    actorId: args.actorId,
    actorName: args.actorName,
    actorType: args.actorType ?? 'user',
    intent,
  })
}
