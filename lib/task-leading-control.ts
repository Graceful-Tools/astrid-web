/**
 * The leading control on a task — the thing at the start of the row you can
 * tap to complete it.
 *
 * It answers ONE question, "whose task is this?", and that question has THREE
 * answers, not two (task 2bb1b196, companion to iOS/Mac 42013da7):
 *
 *   assigned to someone else  ->  their photo, in a priority-coloured square
 *   assigned to you           ->  the completion checkbox
 *   assigned to nobody        ->  "U", in a priority-coloured square
 *
 * Unassigned used to be folded in with "mine", so a task nobody owns looked
 * exactly like a task you own — two different states rendering identically.
 *
 * iOS keeps this in one pure `TaskLeadingControl.kind(assigneeId:currentUserId:)`
 * so the row, the detail and quick add cannot disagree about the same task.
 * This is the web mirror. Decide here, render in
 * `components/task-leading-control.tsx`, never per component.
 *
 * The MARK changes between the three; the ACTION does not — tapping any of
 * them completes the task.
 */

export type TaskLeadingControlKind = 'avatar' | 'checkbox' | 'unassigned'

export interface TaskLeadingControlInput {
  assigneeId?: string | null
  currentUserId?: string | null
  /** Completed tasks need a mark that can read as checked; "U" cannot. */
  completed?: boolean
}

export function taskLeadingControlKind({
  assigneeId,
  currentUserId,
  completed = false,
}: TaskLeadingControlInput): TaskLeadingControlKind {
  if (!assigneeId) {
    // A completed task must still show that it is completed, and the "U" mark
    // has no checked state to show. Fall back to the checkbox rather than
    // inventing a checked "U".
    return completed ? 'checkbox' : 'unassigned'
  }
  return assigneeId === currentUserId ? 'checkbox' : 'avatar'
}

/**
 * The priority colour used for the leading control's square border.
 *
 * Six components had defined this switch privately with identical output
 * (project-status-board, task-detail, task-detail-viewonly, TaskManager,
 * mobile-quick-add, public-task-browser). One copy, since "priority-coloured
 * square" is part of the cross-platform contract above.
 */
export function getPriorityColor(priority: number): string {
  switch (priority) {
    case 3: return 'rgb(239, 68, 68)'   // Red - highest priority
    case 2: return 'rgb(251, 191, 36)'  // Yellow - medium priority
    case 1: return 'rgb(59, 130, 246)'  // Blue - low priority
    default: return 'rgb(107, 114, 128)' // Gray - no priority
  }
}
