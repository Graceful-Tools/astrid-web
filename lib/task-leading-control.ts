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
 *
 * A BOARD'S TASK CHANGES THE ACTION ALONE (task 036ef139). Seen in list view,
 * tapping it opens the same sheet — the board's states are otherwise
 * unreachable from the row — but the mark stays the list-mode checkbox. See
 * `leadingControlOpensOptions` below for why the two are decided separately.
 *
 * SOMEONE ELSE'S TASK CHANGES THE ACTION EVERYWHERE (AWTD-877, with iOS
 * AITD-375). Jon, for both platforms: "When not yours, always confirm before
 * completing. On web and iOS it should give the popover to show assignment,
 * complete, priority and status options just like in project mode." So the
 * tap opens the sheet on every surface and in both modes, and completing from
 * that sheet asks first. The mark is untouched: it was already their photo.
 *
 * A TAP COMPLETES ONLY WHAT IS DRAWN AS A CHECKBOX (AWTD-919, with iOS
 * AITD-382). The three rules above are all about WHERE you are and WHOSE the
 * task is, and between them they never asked about the mark on screen — so an
 * unassigned task on a plain list row completed on a tap while displaying "U".
 * That glyph exists BECAUSE a task nobody owns was being depicted exactly like
 * a task you own; completing on a tap is what a checkbox means, and it is not
 * what "U" means. The mark is now the first thing the action asks about.
 *
 * The three ownership states therefore agree at last: nobody's, an agent's and
 * another person's task all open the sheet on a row. The first two had only
 * ever agreed by accident — an agent is an avatar with an id that is not
 * yours, so `isSomeoneElses` caught it, while unassigned fell through every
 * clause. iOS collapsed its `.listRow` and `.detail` cases into one for the
 * same reason: they had been disagreeing about the same task.
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

/**
 * Is this task assigned to somebody who is not the person looking at it?
 *
 * The one question behind both of the rules below, so they cannot answer it
 * differently. iOS keeps the same predicate in `TaskLeadingControlKind`, and the
 * three traps it exists to avoid are all cases where a near-miss looks right:
 *
 *  1. "Is it an avatar" is NOT "is it theirs". In project mode your own task
 *     wears your photo too (task ffa5bbb5), so keying anything off the MARK
 *     makes people confirm their own completions. This compares ids.
 *  2. Unassigned is nobody's, and `''` is how the API says unassigned — not
 *     just null. There is no one whose work you would be finishing.
 *  3. An unknown viewer counts as "not yours". If `currentUserId` is absent you
 *     cannot show the task is theirs, and the safe answer is the one that asks.
 */
export function isSomeoneElsesTask({
  assigneeId,
  currentUserId,
}: {
  assigneeId?: string | null
  currentUserId?: string | null
}): boolean {
  if (!assigneeId) return false
  return assigneeId !== currentUserId
}

/**
 * Does tapping the leading control open the options sheet rather than
 * completing the task?
 *
 * FOUR conditions, OR'd (tasks 036ef139, AWTD-877, AWTD-919):
 *
 *   the mark is not a  a tap completes a CHECKBOX; "U" and an avatar are not
 *   CHECKBOX           checkboxes and must not finish anyone's work (AWTD-919)
 *
 *   project display mode  the user's own Appearance preference (task ffa5bbb5)
 *   the task is on a BOARD  Jon: "In board view, when in 'list' mode the
 *                         checkbox when tapped should provide the 'status'
 *                         picker (inbox, ready, doing, waiting, done, or
 *                         custom status)"
 *   it is SOMEONE ELSE'S   Jon, for both platforms: "it should give the popover
 *                         to show assignment, complete, priority and status
 *                         options just like in project mode"
 *
 * Each was ADDED rather than substituted. Until boards were added the only
 * route to the sheet was the display-mode preference, so a board's own tasks
 * completed on tap for everyone who never opened Appearance — the board's
 * states were unreachable from the row that belongs to them. Substituting
 * would have taken the sheet away from project-mode users on a plain list,
 * which nothing asked for.
 *
 * Someone else's task is the condition that holds on EVERY surface, which is
 * why it is checked here rather than per-surface: the row offered nothing at
 * all (its avatar was inert) and details had grown a confirm-on-tap of its own,
 * so the same task behaved three different ways depending on where you met it.
 *
 * ONLY THE ACTION. The MARK still comes from `taskLeadingControlKind` and its
 * display mode alone: "the checkbox when tapped" says the checkbox stays, so a
 * board must not swap in the project-mode avatar for a user who never chose it.
 * Someone else's task needs no help here — it already wears their photo.
 *
 * The `kind` clause READS that decision without making it, which is why it
 * takes the kind rather than an `assigneeId`. `taskLeadingControlKind` returns
 * 'checkbox' for a COMPLETED unassigned task on purpose — the "U" mark has no
 * checked state to show, and un-completing has to stay reachable in one tap —
 * so asking about the mark preserves that by construction, where asking about
 * the assignee would have quietly taken it away.
 */
export function leadingControlOpensOptions({
  displayMode,
  onBoard = false,
  isSomeoneElses = false,
  kind = 'checkbox',
}: {
  displayMode?: TaskDisplayMode | string | null
  /** Is this task's list part of a project board? */
  onBoard?: boolean
  /** From `isSomeoneElsesTask`. Absent means it is yours or nobody's. */
  isSomeoneElses?: boolean
  /**
   * The mark `taskLeadingControlKind` actually drew. Absent means a checkbox,
   * the same convention `displayMode` uses above: callers that predate
   * AWTD-919 must not change behaviour, and every one of them was a checkbox.
   */
  kind?: TaskLeadingControlKind
}): boolean {
  // A tap completes a task only when the mark it lands on is a CHECKBOX.
  if (kind !== 'checkbox') return true
  return usesCompactTaskDetail(displayMode) || onBoard || isSomeoneElses
}

/**
 * Does completing this task ask for confirmation first?
 *
 * IT IS SOMEONE ELSE'S — that is the whole rule (AWTD-877). Jon: "When not
 * yours, always confirm before completing."
 *
 * This replaces `leadingControlConfirmsCompletion({ kind, opensOptions,
 * surface })` (task 43bcc76c), and the shrunken signature IS the fix. The old
 * one asked where you were standing and which mark you were looking at, so it
 * could only be true in task details, on an avatar, when the options sheet was
 * not already claiming the tap — three coordinates for a question that has one.
 * Whose work you are about to finish does not change with the surface.
 *
 * It also stopped being a TAP OUTCOME. The tap opens the options sheet now, on
 * every surface; the confirmation sits on that sheet's Complete button, where
 * it also covers the project-mode and board completions that previously had
 * none.
 */
export function completionNeedsConfirmation({
  assigneeId,
  currentUserId,
}: {
  assigneeId?: string | null
  currentUserId?: string | null
}): boolean {
  return isSomeoneElsesTask({ assigneeId, currentUserId })
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
