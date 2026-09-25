/**
 * Whether task details show a BOARD STATE row, and which chips it offers.
 *
 * The web third of a rule iOS and Mac already share. `Astrid App/Core/Layout/
 * TaskDetailProjectStateRow.swift` states it there (AITD-327 on the Mac,
 * AITD-332 on iOS) and ends by naming this file's job:
 *
 *     Mirrors nothing on web yet; when the web board detail grows the row,
 *     this is the rule it is copying.
 *
 * So it is copied rather than redesigned (task 5221e43f). The reason the rule
 * is stated once per platform rather than spelled at each call site is on
 * record: Priority-before-Who shipped on iOS AND Mac simultaneously because two
 * views each decided the same layout question for themselves (task c8a1ff51).
 *
 * The narrowing that makes the row correct rather than a hybrid: a board column
 * IS a project idea, and a row for one in the list layout would rebuild exactly
 * the mixture the display-mode setting exists to end — for a task that has no
 * board column. For a task that is ON a board, the column is real information
 * the list layout was merely hiding, and before this row the only way to reach
 * it was to switch display modes. `isInProject` is the whole design.
 */
import type { Task, TaskList } from '@/types/task'
import { VIRTUAL_DONE_COLUMN_ID, type ProjectBoardColumn } from '@/lib/project-status'
import { usesCompactTaskDetail } from '@/lib/task-display-mode'

export interface TaskDetailProjectStateVisibility {
  /** The viewer's Appearance setting: 'list' | 'project'; absent means list. */
  displayMode: string | null | undefined
  /** Does the task have a board column at all? Ask `isTaskInProject`. */
  isInProject: boolean
  /** The public-list viewer, who may read but not write. */
  isReadOnly: boolean
}

/**
 * Does the board-state row appear?
 *
 * - **List mode only.** In project mode the state already lives behind the
 *   leading control's quick changer, and a row would say it twice in the
 *   layout that is compact on purpose.
 * - **On a board only** — see the module comment.
 * - **Not read-only.** The row is a MOVER, not a label: its chips write. So it
 *   follows Who and Priority, which are hidden from a public-list viewer
 *   rather than rendered as controls that cannot be used.
 */
export function showsTaskDetailProjectState({
  displayMode,
  isInProject,
  isReadOnly,
}: TaskDetailProjectStateVisibility): boolean {
  return !usesCompactTaskDetail(displayMode) && isInProject && !isReadOnly
}

export interface TaskBlockersVisibility {
  /** Does the task have a board column at all? Ask `isTaskInProject`. */
  isInProject: boolean
  /** The public-list viewer, who may read but not write. */
  isReadOnly: boolean
  /** Does it have any blockers to show right now? */
  hasBlockers: boolean
}

/**
 * Does the blockers row appear (AWTD-1002)?
 *
 * Stated here beside `showsTaskDetailProjectState` rather than at the call
 * site, for that rule's reason: iOS and Mac will copy this one rather than each
 * re-deciding it.
 *
 * Three differences from the board-state row, each deliberate:
 *
 * - **Both display modes.** Blocking is not said anywhere else in the compact
 *   layout, so there is no duplicate to avoid.
 * - **Read-only viewers see it.** The row is a LABEL before it is a control,
 *   and a public-list reader benefits from knowing a task is blocked. The
 *   controls inside it are what hides for them.
 * - **Zero blockers renders nothing for a reader**, who has nothing to read.
 *   For someone who can WRITE it still renders, because that empty row is the
 *   only way to add the first blocker — the spec put that affordance in a task
 *   action menu this repo does not have, and a feature reachable only through a
 *   surface nobody built is not shipped. When the menu exists, this becomes
 *   `hasBlockers` alone.
 *
 * Still on a board only: blocking is a board idea, which is the whole design in
 * `isTaskInProject`.
 */
export function showsTaskBlockers({
  isInProject,
  isReadOnly,
  hasBlockers,
}: TaskBlockersVisibility): boolean {
  if (!isInProject) return false
  if (hasBlockers) return true
  // With nothing to show, only someone who could add one has a reason to see
  // the row.
  return !isReadOnly
}

/**
 * Which project a task belongs to, from its OWN list memberships.
 *
 * Deliberately not `getProjectIdForBoard`, which answers for the list the user
 * currently has selected. A detail pane can be opened from search, from a
 * label, or from another list entirely, and the task's board is a fact about
 * the task rather than about where the reader happened to be standing. Mirrors
 * iOS `getProjectIdForTask`.
 *
 * A `statusRole` alone is not enough to name a project — it says the task has a
 * column, not whose board it is on — so membership is the only source here.
 */
export function getProjectIdForTask(
  task: Pick<Task, 'lists'>,
  lists: TaskList[],
): string | null {
  const membership = new Set((task.lists ?? []).map(list => list.id))
  return lists.find(list => membership.has(list.id) && list.projectId)?.projectId ?? null
}

/**
 * Does this task have a board column at all?
 *
 * Either it already carries a status, or it is on a list that belongs to a
 * project. The first case matters because a task can hold a role from a board
 * whose list the viewer cannot see. Mirrors iOS `isTaskInProject`.
 */
export function isTaskInProject(
  task: Pick<Task, 'lists' | 'statusRole'>,
  lists: TaskList[],
): boolean {
  if (task.statusRole) return true
  return getProjectIdForTask(task, lists) !== null
}

/**
 * The chips the row offers: every column except Done.
 *
 * Done is what the Complete button is for (iOS task 7574067b). Offering it as
 * a chip as well gave the same action twice — and the chip was the one that
 * never said it would finish the task.
 *
 * Inbox stays: moving a task back out of Ready is a real thing to want, and it
 * completes nothing.
 */
export function projectStateChips(columns: ProjectBoardColumn[]): ProjectBoardColumn[] {
  return columns.filter(column => column.id !== VIRTUAL_DONE_COLUMN_ID)
}
