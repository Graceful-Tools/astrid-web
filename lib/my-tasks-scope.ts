/**
 * My Tasks: which tasks are the reader's, and how its saved preferences narrow them.
 *
 * Pure — no React, no Prisma — so the contract exporter can run it
 * (scripts/contract-fixtures/drivers/my-tasks.mjs → contracts/fixtures/my-tasks.json). It lived
 * inside hooks/useFilterState.ts until AWTD-1262, where nothing but a rendered list could ask it.
 *
 * Web and the native clients disagree here (astrid-core docs/CONTRACTS.md D25, resolved toward
 * iOS): iOS's My Tasks is only what is assigned to you, read through the nested `assignee` when
 * `assigneeId` is missing, and it ignores `filterAssignee`. Web also keeps unassigned tasks you
 * created, reads `assigneeId` alone, and applies `filterAssignee`. The fixture carries those cases
 * as disputed, so changing this to iOS's rule is a deliberate contract change, not a refactor.
 *
 * Completion and due date are not here: My Tasks applies them through the same functions every
 * list does (lib/recently-completed-window.ts, lib/date-filter-utils.ts), locked by filters.json.
 */

export interface MyTasksScopeTask {
  assigneeId?: string | null
  creatorId?: string | null
  priority?: number | null
}

export interface MyTasksScopePreferences {
  /** Empty means every priority. */
  filterPriority: number[]
  /** Assignee ids, or `'unassigned'`. Empty means everyone. */
  filterAssignee: string[]
}

/** Assigned to the reader, or unassigned and created by them. */
export function isInMyTasksScope(task: MyTasksScopeTask, userId?: string | null): boolean {
  return task.assigneeId === userId || (task.assigneeId === null && task.creatorId === userId)
}

/** The priority filter every list applies: a missing priority reads as 0. */
export function matchesPriorityFilter(task: MyTasksScopeTask, priorities: number[]): boolean {
  return priorities.length === 0 || priorities.includes(task.priority || 0)
}

/** The assignee filter every list applies: no assignee matches `'unassigned'`. */
export function matchesAssigneeFilter(task: MyTasksScopeTask, assignees: string[]): boolean {
  return assignees.length === 0 || assignees.includes(task.assigneeId || 'unassigned')
}

/** In My Tasks, before completion, due date and sort. */
export function myTasksShows(
  task: MyTasksScopeTask,
  userId: string | null | undefined,
  preferences: MyTasksScopePreferences,
): boolean {
  return (
    isInMyTasksScope(task, userId) &&
    matchesPriorityFilter(task, preferences.filterPriority) &&
    matchesAssigneeFilter(task, preferences.filterAssignee)
  )
}
