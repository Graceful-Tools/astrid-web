/**
 * What the My Tasks preferences accept, and what they start as.
 *
 * Shared by the routes that store them, the web hook that edits them and the
 * settings popover that offers them, so the three cannot drift: the popover
 * used to offer three values the API rejected (AWTD-1324). Matches what iOS
 * offers and defaults to (MyTasksFilterSheet.swift, MyTasksPreferences.swift).
 */

import { coreDueDateWindow } from '@/lib/date-filter-utils'
import { coreSortBy } from '@/lib/task-sort'

export interface MyTasksPreferences {
  filterPriority?: number[]
  filterAssignee?: string[]
  filterDueDate?: string
  filterCompletion?: string
  sortBy?: string
  manualSortOrder?: string[]
}

export const MY_TASKS_DUE_DATE_VALUES: readonly string[] = ['all', 'overdue', 'today', 'this_week', 'this_month', 'no_date']
export const MY_TASKS_COMPLETION_VALUES: readonly string[] = ['default', 'all', 'completed', 'incomplete']
export const MY_TASKS_SORT_VALUES: readonly string[] = ['auto', 'priority', 'when', 'manual']

/**
 * Values the preferences used to offer and no longer do (AWTD-1583, astrid-core D33/D35): every
 * client now reads the windows and orders above, and nothing else. They are still ACCEPTED, so an
 * open tab or an older build saving one is not refused, and they are rewritten to the nearest
 * offered value on the way in and on the way out — see {@link normalizeMyTasksPreferences}.
 */
export const RETIRED_MY_TASKS_DUE_DATE_VALUES: readonly string[] = ['tomorrow', 'this_calendar_week', 'this_calendar_month']
export const RETIRED_MY_TASKS_SORT_VALUES: readonly string[] = ['assignee', 'completed', 'incomplete']

/**
 * The preferences with any retired value rewritten (AWTD-1583): a retired window becomes the
 * nearest window every client reads (`coreDueDateWindow`), a retired order becomes `auto`, which
 * is how every client already sorted it. Other fields are untouched; so is an object with nothing
 * to rewrite (it is returned as is).
 */
export function normalizeMyTasksPreferences<T extends MyTasksPreferences>(preferences: T): T {
  const filterDueDate = coreDueDateWindow(preferences.filterDueDate)
  const sortBy = preferences.sortBy && coreSortBy(preferences.sortBy)
  if (filterDueDate === preferences.filterDueDate && sortBy === preferences.sortBy) return preferences
  return { ...preferences, filterDueDate, sortBy }
}

export const MY_TASKS_DEFAULTS: MyTasksPreferences = {
  filterPriority: [],
  filterAssignee: [],
  filterDueDate: 'all',
  filterCompletion: 'default',
  sortBy: 'auto',
  manualSortOrder: [],
}
