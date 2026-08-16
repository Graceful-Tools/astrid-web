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
 * The MARK changes between the three; in LIST mode the ACTION does not —
 * tapping any of them completes the task.
 *
 * PROJECT MODE CHANGES BOTH (task ffa5bbb5). Your own task shows YOUR photo
 * rather than the checkbox — "assigned to you should also show your profile
 * photo" — and tapping opens the options popover (priority, assignee, board
 * state, complete) instead of completing outright. That sentence about the
 * action being invariant was true for two years and is now conditional; it is
 * left above rather than deleted because list mode is still the default and
 * still works exactly that way.
 */

import { usesCompactTaskDetail, type TaskDisplayMode } from '@/lib/task-display-mode'

export type TaskLeadingControlKind = 'avatar' | 'checkbox' | 'unassigned'

export interface TaskLeadingControlInput {
  assigneeId?: string | null
  currentUserId?: string | null
  /** Completed tasks need a mark that can read as checked; "U" cannot. */
  completed?: boolean
  /**
   * The user's task display mode. Optional, and absent means list — every
   * call site that predates task ffa5bbb5 omits it, and none of them may
   * change behaviour. Normalized rather than compared directly so an
   * unrecognised value renders the safe layout.
   */
  displayMode?: TaskDisplayMode | string | null
}

export function taskLeadingControlKind({
  assigneeId,
  currentUserId,
  completed = false,
  displayMode,
}: TaskLeadingControlInput): TaskLeadingControlKind {
  if (!assigneeId) {
    // A completed task must still show that it is completed, and the "U" mark
    // has no checked state to show. Fall back to the checkbox rather than
    // inventing a checked "U".
    //
    // Unchanged in project mode: "also show your photo" is about assignment,
    // and a task nobody owns has no photo to show.
    return completed ? 'checkbox' : 'unassigned'
  }

  if (assigneeId !== currentUserId) return 'avatar'

  // Your own task. In project mode it wears your photo — EXCEPT when it is
  // completed, because an avatar has no checked state and completion has to
  // stay legible in both modes. Same reasoning as the unassigned case above.
  if (!completed && usesCompactTaskDetail(displayMode)) return 'avatar'

  return 'checkbox'
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
