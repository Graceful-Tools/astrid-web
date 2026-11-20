import type { Task } from "@/types/task"
import { applyDateFilter, type DueDateWindow } from "@/lib/date-filter-utils"
import { matchesAssigneeFilter, matchesPriorityFilter } from "@/lib/my-tasks-scope"

/**
 * The Sort & Filters the person has set on the list (ADEV-145). The board used
 * to read only the list's *saved* sort, so choosing a priority, assignee, due
 * date or sort in the popover changed the list view and left the board alone.
 * Same matchers as `useFilterState.applyFiltersToTasks`, so one rule serves both.
 * Completion is not here: the board owns it through its Done column and
 * "Recently completed" window.
 */
export interface BoardLiveFilters {
  priority: number[]
  assignee: string[]
  dueDate: DueDateWindow
}

export function applyBoardLiveFilters(tasks: Task[], filters: BoardLiveFilters | undefined): Task[] {
  if (!filters) return tasks
  let filtered = tasks
  if (filters.priority.length > 0) {
    filtered = filtered.filter(task => matchesPriorityFilter(task, filters.priority))
  }
  if (filters.assignee.length > 0) {
    filtered = filtered.filter(task => matchesAssigneeFilter(task, filters.assignee))
  }
  if (filters.dueDate !== "all") {
    filtered = filtered.filter(task => {
      if (filters.dueDate === "overdue" && (!task.dueDateTime || task.completed)) return false
      return applyDateFilter(task, filters.dueDate)
    })
  }
  return filtered
}
