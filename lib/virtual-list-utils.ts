import { Task, TaskList } from "@/types/task"
import { applyDateFilter } from "@/lib/date-filter-utils"
import { createLogger } from '@/lib/logger'

const log = createLogger('virtual-list-utils')


export function applyVirtualListFilter(
  tasks: Task[],
  list: TaskList,
  currentUserId: string
): Task[] {
  // Debug logging disabled to reduce console noise
  // log.info({
  //   listId: list.id,
  //   listName: list.name,
  //   isVirtual: list.isVirtual,
  //   virtualListType: list.virtualListType,
  //   tasksCount: tasks.length,
  //   listFilters: {
  //     filterDueDate: list.filterDueDate,
  //     filterAssignee: list.filterAssignee,
  //     filterCompletion: list.filterCompletion,
  //     filterAssignedBy: list.filterAssignedBy,
  //     filterPriority: list.filterPriority,
  //     filterInLists: list.filterInLists
  //   }
  // }, '🔍 applyVirtualListFilter called:')

  if (!list.isVirtual) {
    // For regular lists, filter by list membership
    return tasks.filter(task =>
      task.lists && task.lists.some(taskList => taskList.id === list.id)
    )
  }

  // For virtual lists (saved filters), start with all tasks and apply filters
  let filtered = tasks

  // Apply predefined virtual list behavior if virtualListType is set
  if (list.virtualListType) {
    switch (list.virtualListType) {
    case "today":
      // Base filtering for "today" - but let filter settings override the assignee logic
      filtered = tasks.filter(task => {
        // Only apply assignee filter if not explicitly set in filter settings
        if (!list.filterAssignee || list.filterAssignee === "all") {
          const isAssignedToUser = task.assigneeId === currentUserId
          if (!isAssignedToUser) return false
        }

        // Only apply due date filter if not explicitly set in filter settings
        if (!list.filterDueDate || list.filterDueDate === "all") {
          // Includes today's tasks AND overdue incomplete tasks
          return applyDateFilter(task, "today")
        }
        
        return true // Let other filters handle the logic
      })
      break

    case "not-in-list":
      // Base filtering for "not-in-list" - but let filter settings override
      filtered = tasks.filter(task => {
        // Only apply assignee filter if not explicitly set in filter settings
        if (!list.filterAssignee || list.filterAssignee === "all") {
          const isAssignedToUser = task.assigneeId === currentUserId
          if (!isAssignedToUser) return false
        }

        // Only apply list filter if not explicitly set in filter settings
        if (!list.filterInLists || list.filterInLists === "dont_filter") {
          const hasNoLists = !task.lists || task.lists.length === 0
          return hasNoLists
        }
        
        return true // Let other filters handle the logic
      })
      break

    case "assigned":
      // Base filtering for "assigned" - but let filter settings override
      filtered = tasks.filter(task => {
        // Only apply creator filter if not explicitly set in filter settings
        if (!list.filterAssignedBy || list.filterAssignedBy === "all") {
          if (task.creatorId !== currentUserId) return false
        }

        // Only apply assignee filter if not explicitly set in filter settings
        if (!list.filterAssignee || list.filterAssignee === "all") {
          return task.assigneeId !== currentUserId && task.assigneeId !== null
        }

        return true // Let other filters handle the logic
      })
      break

    case "my-tasks":
      // Base filtering for "my-tasks" - show only tasks assigned to current user
      filtered = tasks.filter(task => {
        // Only apply assignee filter if not explicitly set in filter settings
        if (!list.filterAssignee || list.filterAssignee === "all") {
          // For My Tasks, only show tasks assigned to the current user (exclude unassigned)
          return task.assigneeId === currentUserId
        }

        return true // Let other filters handle the logic
      })
      break

    default:
      // Custom virtual list without predefined type - use all tasks and rely on filters
      filtered = tasks
    }
  }

  // Apply additional filters from the list settings
  if (list.filterCompletion && list.filterCompletion !== "all") {
    filtered = filtered.filter(task => {
      if (list.filterCompletion === "completed") {
        return task.completed
      } else if (list.filterCompletion === "incomplete") {
        return !task.completed
      }
      return true
    })
  }

  if (list.filterDueDate && list.filterDueDate !== "all") {
    // Use Google Calendar approach: UTC comparison for all-day, local for timed
    filtered = filtered.filter(task => applyDateFilter(task, list.filterDueDate!))
  }

  // Apply filterAssignee filter
  if (list.filterAssignee && list.filterAssignee !== "all") {
    filtered = filtered.filter(task => {
      if (list.filterAssignee === "current_user") {
        return task.assigneeId === currentUserId
      } else if (list.filterAssignee === "unassigned") {
        return !task.assigneeId
      } else if (list.filterAssignee === "not_current_user") {
        return task.assigneeId !== currentUserId && task.assigneeId !== null
      } else {
        // Specific user ID
        return task.assigneeId === list.filterAssignee
      }
    })
  }

  // Apply filterAssignedBy filter
  if (list.filterAssignedBy && list.filterAssignedBy !== "all") {
    filtered = filtered.filter(task => {
      if (list.filterAssignedBy === "current_user") {
        return task.creatorId === currentUserId
      } else {
        // Specific user ID
        return task.creatorId === list.filterAssignedBy
      }
    })
  }

  // Apply filterPriority filter
  if (list.filterPriority && list.filterPriority !== "all") {
    filtered = filtered.filter(task => {
      const priority = parseInt(list.filterPriority!)
      if (!isNaN(priority)) {
        return task.priority === priority
      }
      return true
    })
  }

  // Apply filterRepeating filter — mirrors applyRepeatingFilter in the iOS/Mac shared engine
  // (Astrid App/Core/Filters/ListTaskFiltering.swift). "all"/absent keeps everything,
  // "not_repeating" keeps tasks with NO rule (null or "never"), and a cadence keeps only that
  // cadence. An unrecognised value keeps everything, so a newer client can never blank a list.
  if (list.filterRepeating && list.filterRepeating !== "all") {
    const REPEAT_CADENCES = ["daily", "weekly", "monthly", "yearly", "custom"]
    const filterValue = list.filterRepeating
    if (filterValue === "not_repeating") {
      filtered = filtered.filter(task => !task.repeating || task.repeating === "never")
    } else if (REPEAT_CADENCES.includes(filterValue)) {
      filtered = filtered.filter(task => task.repeating === filterValue)
    }
  }

  // Apply filterInLists filter
  if (list.filterInLists && list.filterInLists !== "dont_filter") {
    filtered = filtered.filter(task => {
      const hasLists = task.lists && task.lists.length > 0
      
      if (list.filterInLists === "in_list") {
        return hasLists // Show tasks that are in any list
      } else if (list.filterInLists === "not_in_list") {
        return !hasLists // Show tasks that are NOT in any list
      }
      
      return true
    })
  }

  // Debug logging disabled to reduce console noise
  // log.info({
  //   listId: list.id,
  //   originalCount: tasks.length,
  //   filteredCount: filtered.length,
  //   filteredTaskTitles: filtered.map(t => ({ id: t.id, title: t.title, when: t.when }))
  // }, '🔍 applyVirtualListFilter result:')

  return filtered
}

export function getListDisplayInfo(list: TaskList | null) {
  if (!list) {
    return { name: "My Tasks", description: "all your tasks" }
  }

  return {
    name: list.name,
    description: list.description || `tasks in ${list.name}`
  }
}