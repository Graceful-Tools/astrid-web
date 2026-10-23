/**
 * The options both task-create entry points take (AWTD-1227).
 *
 * `handleCreateTask` and `handleQuickCreateTask` in
 * `hooks/useTaskManagerController.ts` declared this inline, identically, twice
 * — so adding `parentTaskId` meant editing the same union in two places, and
 * forgetting one would have compiled: the quick-add path would simply have
 * ignored a parent it was handed.
 *
 * Stated once here rather than in the controller, which is budgeted by
 * `tests/rules/oversized-files-ratchet.test.ts`.
 */
export interface CreateTaskOptions {
  priority?: number
  assigneeId?: string | null
  navigateToDetail?: boolean
  listIds?: string[]
  /** Board column at creation — a role, resolved by the board (task eb7fce2f). */
  statusRole?: string
  /**
   * The task this one is a subtask of. Set by the detail pane's add-subtask
   * row; absent for every other caller, so nothing else changes shape.
   */
  parentTaskId?: string | null
}

/**
 * Should a just-created task open in the detail pane (AWTD-1351)?
 *
 * Only when the caller asked — quick add's button does, Enter does not — and
 * only where the pane sits beside the list. Creating used to select every new
 * task on a multi-column layout regardless, without writing `?task=`, so the
 * row's toggle treated the first click on it as "close".
 */
export function shouldOpenCreatedTask(
  options: CreateTaskOptions | undefined,
  columnCount: number,
): boolean {
  return options?.navigateToDetail === true && columnCount >= 2
}
