/**
 * My Tasks: which tasks are the reader's, and how its saved preferences narrow them.
 *
 * Pure — no React, no Prisma — so the contract exporter can run it
 * (scripts/contract-fixtures/drivers/my-tasks.mjs → contracts/fixtures/my-tasks.json). It lived
 * inside hooks/useFilterState.ts until AWTD-1262, where nothing but a rendered list could ask it.
 *
 * Web follows iOS and astrid-core here (`filters::my_tasks::filter`; docs/CONTRACTS.md D25,
 * resolved toward iOS, adopted on web in AWTD-1583): My Tasks is only what is assigned to you —
 * read through the nested `assignee` when `assigneeId` is missing — it is empty signed out, and it
 * ignores `filterAssignee`. Until AWTD-1583 web also kept unassigned tasks you created, read
 * `assigneeId` alone, and applied `filterAssignee`.
 *
 * Completion and due date are not here: My Tasks applies them through the same functions every
 * list does (lib/recently-completed-window.ts, lib/date-filter-utils.ts), locked by filters.json.
 */

export interface MyTasksScopeTask {
  assigneeId?: string | null
  /** The nested assignee, which stands in for a missing `assigneeId`. */
  assignee?: { id?: string | null } | null
  creatorId?: string | null
  priority?: number | null
}

export interface MyTasksScopePreferences {
  /** Empty means every priority. */
  filterPriority: number[]
  /** Carried for the round trip; My Tasks does not apply it (D25). */
  filterAssignee?: string[]
}

/** Assigned to the reader. Signed out (no reader), nothing is. */
export function isInMyTasksScope(task: MyTasksScopeTask, userId?: string | null): boolean {
  if (!userId) return false
  return (task.assigneeId ?? task.assignee?.id ?? null) === userId
}

/** The priority filter every list applies: a missing priority reads as 0. */
export function matchesPriorityFilter(task: MyTasksScopeTask, priorities: number[]): boolean {
  return priorities.length === 0 || priorities.includes(task.priority || 0)
}

/** The assignee filter every list applies: no assignee matches `'unassigned'`. */
export function matchesAssigneeFilter(task: MyTasksScopeTask, assignees: string[]): boolean {
  return assignees.length === 0 || assignees.includes(task.assigneeId || 'unassigned')
}

/** In My Tasks, before completion, due date and sort. `filterAssignee` is not read (D25). */
export function myTasksShows(
  task: MyTasksScopeTask,
  userId: string | null | undefined,
  preferences: MyTasksScopePreferences,
): boolean {
  return isInMyTasksScope(task, userId) && matchesPriorityFilter(task, preferences.filterPriority)
}
