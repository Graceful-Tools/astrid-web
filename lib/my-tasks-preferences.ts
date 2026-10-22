/**
 * What the My Tasks preferences accept, and what they start as.
 *
 * Shared by the routes that store them, the web hook that edits them and the
 * settings popover that offers them, so the three cannot drift: the popover
 * used to offer three values the API rejected (AWTD-1324). Matches what iOS
 * offers and defaults to (MyTasksFilterSheet.swift, MyTasksPreferences.swift).
 */

export interface MyTasksPreferences {
  filterPriority?: number[]
  filterAssignee?: string[]
  filterDueDate?: string
  filterCompletion?: string
  sortBy?: string
  manualSortOrder?: string[]
}

export const MY_TASKS_DUE_DATE_VALUES: readonly string[] = ['all', 'overdue', 'today', 'tomorrow', 'this_week', 'this_month', 'no_date']
export const MY_TASKS_COMPLETION_VALUES: readonly string[] = ['default', 'all', 'completed', 'incomplete']
export const MY_TASKS_SORT_VALUES: readonly string[] = ['auto', 'priority', 'when', 'assignee', 'completed', 'incomplete', 'manual']

export const MY_TASKS_DEFAULTS: MyTasksPreferences = {
  filterPriority: [],
  filterAssignee: [],
  filterDueDate: 'all',
  filterCompletion: 'default',
  sortBy: 'auto',
  manualSortOrder: [],
}
