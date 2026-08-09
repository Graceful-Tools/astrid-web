/**
 * Moving a task out of being a subtask, by dragging it. (Task b00a1f94)
 *
 * Astrid tasks nest through `Task.parentTaskId`. Until now the only way out of
 * a nesting was editing the task; drag-and-drop could move a task between lists
 * and reorder it within one, but never unnest it.
 *
 * The decision lives here rather than in the drag handlers because it is
 * answerable without a DOM and it is the part that goes wrong quietly: offering
 * the target for a task that has no parent, or firing a write that clears an
 * already-null parent.
 */

import type { Task } from "@/types/task"

/** Drop-zone identifier, shared by the renderer and the drop handler. */
export const PROMOTE_DROP_TARGET_ID = "promote-to-top-level"

type TaskLike = Pick<Task, "id"> & { parentTaskId?: string | null }

/** True when the task is nested under another and so has somewhere to move out of. */
export function canPromoteToTopLevel(task: TaskLike | null | undefined): boolean {
  return !!task?.parentTaskId
}

/**
 * Whether the drop target should be on screen.
 *
 * Only while a **subtask** is in flight. A permanently visible "unnest" strip
 * would be noise for the common case — most tasks are not subtasks and most
 * drags are reorders — and the task asks for the target to be *clear*, which
 * means present exactly when it is meaningful.
 */
export function shouldShowPromoteTarget(draggedTask: TaskLike | null | undefined): boolean {
  return canPromoteToTopLevel(draggedTask)
}

export interface PromotionResult {
  taskId: string
  /** Always null — this operation exists to clear the parent. */
  parentTaskId: null
}

/**
 * What dropping on the target should write, or null when the drop is a no-op.
 *
 * Only the task's link to its PARENT is cut. Its own children travel with it,
 * still nested under it. Pulling grandchildren up as well is a different
 * product decision, and doing it silently on a drag would be a surprise that is
 * awkward to undo.
 */
export function resolvePromotion(task: TaskLike | null | undefined): PromotionResult | null {
  if (!canPromoteToTopLevel(task)) return null
  return { taskId: task!.id, parentTaskId: null }
}
