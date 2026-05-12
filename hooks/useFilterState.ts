import { useState, useCallback, useMemo, useEffect } from 'react'
import { useMyTasksPreferences } from './useMyTasksPreferences'
import type { Task, TaskList } from '@/types/task'
import { hasListAccess } from '@/lib/list-member-utils'
import { applyDateFilter } from '@/lib/date-filter-utils'
import {
  shouldShowCompletedByFilter,
  type CompletionFilterMode,
  type RecentlyCompletedWindow,
} from '@/lib/recently-completed-window'

export interface FilterState {
  search: string
  completed: "all" | "completed" | "incomplete" | "default"
  priority: number[]
  assignee: string[]
  dueDate: "all" | "overdue" | "today" | "tomorrow" | "this_week" | "this_month" | "this_calendar_week" | "this_calendar_month" | "no_date"
  sortBy: "auto" | "priority" | "when" | "assignee" | "completed" | "incomplete" | "manual"
}

interface UseFilterStateProps {
  selectedListId: string
  currentList?: TaskList
  getManualOrder?: (listId: string) => string[] | undefined
}

const getValidSortBy = (value?: string | null): FilterState['sortBy'] => {
  switch (value) {
    case "priority":
    case "when":
    case "assignee":
    case "completed":
    case "incomplete":
    case "manual":
      return value
    // Legacy support: convert old "due_date" to "when"
    case "due_date":
      return "when"
    default:
      return "auto"
  }
}

export const useFilterState = ({ selectedListId, currentList, getManualOrder }: UseFilterStateProps) => {
  // Helper function to ensure filterCompletion is a valid value
  const getValidFilterCompletion = (value?: string | null): "all" | "completed" | "incomplete" | "default" => {
    if (value === "all" || value === "completed" || value === "incomplete" || value === "default") {
      return value
    }
    return "default" // Changed from "incomplete" to make "default" the new default
  }

  // Regular filter state (not persisted)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterCompleted, setFilterCompleted] = useState<"all" | "completed" | "incomplete" | "default">(
    getValidFilterCompletion(currentList?.filterCompletion)
  )
  const [filterPriority, setFilterPriority] = useState<number[]>([])
  const [filterAssignee, setFilterAssignee] = useState<string[]>([])
  const [filterDueDate, setFilterDueDate] = useState<"all" | "overdue" | "today" | "tomorrow" | "this_week" | "this_month" | "this_calendar_week" | "this_calendar_month" | "no_date">("all")
  const [sortBy, setSortBy] = useState<FilterState['sortBy']>(getValidSortBy(currentList?.sortBy))

  // Determine which filter set to use based on selected list
  const isMyTasks = selectedListId === "my-tasks"

  // My Tasks persistent filters (synced across devices)
  const myTasksPreferences = useMyTasksPreferences()

  // Update filter states when currentList changes
  useEffect(() => {
    if (currentList && !isMyTasks) {
      setFilterCompleted(getValidFilterCompletion(currentList.filterCompletion))
    }
  }, [currentList, isMyTasks])

  useEffect(() => {
    if (currentList && !isMyTasks) {
      setSortBy(getValidSortBy(currentList.sortBy))
    }
  }, [currentList, isMyTasks])
  
  const activeFilters = useMemo(() => {
    if (isMyTasks) {
      const myTasksResult = {
        search: searchQuery,
        completed: myTasksPreferences.filters.completion,
        priority: myTasksPreferences.filters.priority,
        assignee: myTasksPreferences.filters.assignee,
        dueDate: myTasksPreferences.filters.dueDate,
        sortBy: myTasksPreferences.filters.sortBy
      }
      console.log('My Tasks active filters:', myTasksResult)
      return myTasksResult
    }

    const regularListsResult = {
      search: searchQuery,
      completed: filterCompleted,
      priority: filterPriority,
      assignee: filterAssignee,
      dueDate: filterDueDate,
      sortBy: sortBy
    }
    console.log('Regular lists active filters:', regularListsResult, 'for list:', selectedListId)
    return regularListsResult
  }, [
    isMyTasks,
    searchQuery,
    filterCompleted,
    filterPriority,
    filterAssignee,
    filterDueDate,
    sortBy,
    selectedListId,
    myTasksPreferences.filters
  ])

  const hasActiveFilters = useMemo(() => {
    if (isMyTasks) {
      return myTasksPreferences.hasActiveFilters || searchQuery.trim().length > 0
    }

    return (
      searchQuery.trim().length > 0 ||
      filterCompleted !== "default" ||
      filterPriority.length > 0 ||
      filterAssignee.length > 0 ||
      filterDueDate !== "all" ||
      sortBy !== "auto"
    )
  }, [
    isMyTasks,
    searchQuery,
    filterCompleted,
    filterPriority,
    filterAssignee,
    filterDueDate,
    sortBy,
    myTasksPreferences.hasActiveFilters
  ])

  const setFilterValue = useCallback((key: keyof FilterState, value: any) => {
    console.log(`Setting filter ${key} to:`, value, `for list:`, selectedListId, `isMyTasks:`, isMyTasks)
    if (isMyTasks) {
      switch (key) {
        case 'search':
          setSearchQuery(value)
          break
        case 'completed':
          myTasksPreferences.setters.setFilterCompletion(value)
          break
        case 'priority':
          myTasksPreferences.setters.setFilterPriority(value)
          break
        case 'assignee':
          myTasksPreferences.setters.setFilterAssignee(value)
          break
        case 'dueDate':
          myTasksPreferences.setters.setFilterDueDate(value)
          break
        case 'sortBy':
          myTasksPreferences.setters.setSortBy(value)
          break
      }
    } else {
      switch (key) {
        case 'search':
          setSearchQuery(value)
          break
        case 'completed':
          console.log('Setting regular list completed filter to:', value)
          setFilterCompleted(value)
          break
        case 'priority':
          console.log('Setting regular list priority filter to:', value)
          setFilterPriority(value)
          break
        case 'assignee':
          setFilterAssignee(value)
          break
        case 'dueDate':
          setFilterDueDate(value)
          break
        case 'sortBy':
          setSortBy(value)
          break
      }
    }
  }, [isMyTasks, myTasksPreferences.setters, selectedListId])

  const clearAllFilters = useCallback(() => {
    setSearchQuery("")
    
    if (isMyTasks) {
      myTasksPreferences.clearAllFilters()
    } else {
      setFilterCompleted(getValidFilterCompletion(currentList?.filterCompletion))
      setFilterPriority([])
      setFilterAssignee([])
      setFilterDueDate("all")
      setSortBy("auto")
    }
  }, [isMyTasks, myTasksPreferences, currentList])

  const applyFiltersToTasks = useCallback((tasks: Task[], userId?: string, lists?: TaskList[], skipListFiltering = false, skipVirtualListFilters = false): Task[] => {
    let filtered = [...tasks]

    // console.log('🔍 applyFiltersToTasks:', { tasksCount: tasks.length, activeFilters, selectedListId })

    // Check if we have an active search - if so, search universally across all accessible tasks
    const isUniversalSearch = activeFilters.search.trim().length > 0
    
    // FIRST: Apply list membership filter - this is crucial! (unless skipping or doing universal search)
    if (!skipListFiltering && !isUniversalSearch) {
      const currentList = lists?.find(l => l.id === selectedListId)
      
      if (selectedListId === "my-tasks") {
        // All tasks assigned to current user (or created by them if no assignee)
        filtered = filtered.filter(task => 
          task.assigneeId === userId || 
          (task.assigneeId === null && task.creatorId === userId)
        )
      } else if (selectedListId === "public") {
        // Public tasks the user is following
        filtered = filtered.filter(task =>
          task.lists && task.lists.some(list => list && (list as any).privacy === "PUBLIC")
        )
      } else if (currentList) {
        if (currentList.virtualListType) {
          // Virtual lists show all tasks matching filter criteria (don't filter by list membership)
          filtered = tasks
        } else {
          // Regular lists only show tasks that are actually in this list
          // Filter out null/undefined list references (deleted lists)
          filtered = filtered.filter(task =>
            task.lists && task.lists.some(taskList => taskList && taskList.id === selectedListId)
          )
        }
      } else {
        // List not found, show no tasks
        filtered = []
      }
    } else if (isUniversalSearch) {
      // For universal search, filter to only tasks the user has access to
      filtered = filtered.filter(task => {
        // User has access to task if:
        // 1. They created it
        // 2. They are assigned to it  
        // 3. They are a member of at least one list containing the task
        // 4. The task is in a public list
        
        if (task.creatorId === userId || task.assigneeId === userId) {
          return true
        }
        
        if (task.lists && task.lists.length > 0) {
          return task.lists.some(taskList => {
            // Filter out null/undefined list references (deleted lists)
            if (!taskList) return false

            const list = lists?.find(l => l.id === taskList.id)
            if (!list) return false

            // Public lists are accessible to all
            if (list.privacy === 'PUBLIC') return true

            // Check if user is owner, admin, or member of the list
            return userId ? hasListAccess(list, userId) : false
          })
        }
        
        return false
      })
    }

    // THEN: Apply other filters
    
    // Search filter
    if (activeFilters.search.trim()) {
      const searchLower = activeFilters.search.toLowerCase()
      filtered = filtered.filter(task => 
        task.title.toLowerCase().includes(searchLower) ||
        (task.description && task.description.toLowerCase().includes(searchLower))
      )
    }

    // Completion filter (always apply unless we know the virtual list already handled it)
    // IMPORTANT: During universal search, show ALL tasks (completed + incomplete) by default
    // This ensures search is truly universal and shows all matching results
    if (activeFilters.completed !== "all" && !isUniversalSearch) {
      // Default mode honors the per-list "Recently completed" window
      // (null → legacy 24h). Same helper drives the board's Done column.
      const window = (currentList?.recentlyCompletedWindow ?? null) as RecentlyCompletedWindow | null
      const now = new Date()
      const mode = activeFilters.completed as CompletionFilterMode
      filtered = filtered.filter(task => shouldShowCompletedByFilter(task, mode, window, now))
    }

    // Priority filter (always apply unless we know the virtual list already handled it)
    if (activeFilters.priority.length > 0) {
      console.log('🔍 Applying priority filter:', activeFilters.priority)
      filtered = filtered.filter(task =>
        activeFilters.priority.includes(task.priority || 0)
      )
    }

    // Assignee filter (always apply unless we know the virtual list already handled it)
    if (activeFilters.assignee.length > 0) {
      console.log('🔍 Applying assignee filter:', activeFilters.assignee)
      filtered = filtered.filter(task => {
        const assigneeId = task.assigneeId || 'unassigned'
        return activeFilters.assignee.includes(assigneeId)
      })
    }

    // Due date filter (always apply unless we know the virtual list already handled it)
    if (activeFilters.dueDate !== "all") {
      console.log('🔍 Applying due date filter:', activeFilters.dueDate)
      // Use date-filter-utils which correctly handles timezone for all-day vs timed tasks
      // All-day tasks: UTC comparison (timezone-independent)
      // Timed tasks: Local timezone comparison
      filtered = filtered.filter(task => {
        // Special handling for overdue filter - exclude completed tasks
        if (activeFilters.dueDate === "overdue") {
          if (!task.dueDateTime || task.completed) return false
          return applyDateFilter(task, "overdue")
        }

        return applyDateFilter(task, activeFilters.dueDate)
      })
    }

    // Prepare manual sort ordering if needed
    let manualOrderMap: Map<string, number> | null = null
    if (activeFilters.sortBy === "manual") {
      const manualOrder = getManualOrder?.(selectedListId) ?? []
      manualOrderMap = new Map(manualOrder.map((id, index) => [id, index]))

      const manualOrderSet = new Set(manualOrder)
      if (manualOrderMap.size < filtered.length) {
        const fallbackTasks = filtered
          .filter(task => !manualOrderSet.has(task.id))
          .sort((taskA, taskB) => {
            const aCreated = taskA.createdAt ? new Date(taskA.createdAt).getTime() : 0
            const bCreated = taskB.createdAt ? new Date(taskB.createdAt).getTime() : 0
            return aCreated - bCreated
          })

        let nextIndex = manualOrderMap.size
        fallbackTasks.forEach(task => {
          if (!manualOrderMap!.has(task.id)) {
            manualOrderMap!.set(task.id, nextIndex++)
          }
        })
      }
    }

    // Apply sorting
    const sortedTasks = [...filtered].sort((a, b) => {
      switch (activeFilters.sortBy) {
        case "priority":
          return (b.priority || 0) - (a.priority || 0)

        case "when":
          // Sort by when/dueDate field (earlier dates first)
          const aDate = a.when || a.dueDate
          const bDate = b.when || b.dueDate
          if (!aDate && !bDate) return 0
          if (!aDate) return 1
          if (!bDate) return -1
          return new Date(aDate).getTime() - new Date(bDate).getTime()
        
        case "assignee":
          const aName = a.assignee?.name || a.assignee?.email || "Unassigned"
          const bName = b.assignee?.name || b.assignee?.email || "Unassigned"
          return aName.localeCompare(bName)
        
        case "completed":
          if (a.completed === b.completed) return 0
          return a.completed ? 1 : -1
        
        case "incomplete":
          if (a.completed === b.completed) return 0
          return a.completed ? -1 : 1

        case "manual":
          if (!manualOrderMap) {
            const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0
            const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0
            return aCreated - bCreated
          }
          return (manualOrderMap.get(a.id) ?? manualOrderMap.size) - (manualOrderMap.get(b.id) ?? manualOrderMap.size)
        
        case "auto":
        default:
          // Auto sort: Completion status → Priority → Due date
          // Completed tasks go to the bottom

          // 1. Completion status (incomplete first, completed at bottom)
          if (a.completed !== b.completed) {
            return a.completed ? 1 : -1
          }

          // 2. Priority (higher priority first)
          if ((a.priority || 0) !== (b.priority || 0)) {
            return (b.priority || 0) - (a.priority || 0)
          }

          // 3. Due date (earlier dates first, no date at end)
          const aDue = a.dueDateTime || a.when
          const bDue = b.dueDateTime || b.when
          if (aDue && bDue) {
            return new Date(aDue).getTime() - new Date(bDue).getTime()
          }
          if (aDue && !bDue) return -1
          if (!aDue && bDue) return 1

          // 4. Creation Date - earlier created first (tiebreaker)
          if (a.createdAt && b.createdAt) {
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          }

          // 5. Task name - alphabetical (final tiebreaker)
          return a.title.localeCompare(b.title)
      }
    })

    // console.log('🔍 applyFiltersToTasks result:', { original: tasks.length, filtered: filtered.length, final: sortedTasks.length })

    return sortedTasks
  }, [activeFilters, selectedListId, currentList, getManualOrder])

  return {
    // Current filter values
    filters: activeFilters,
    hasActiveFilters,
    
    // Filter setters
    setSearch: (value: string) => setFilterValue('search', value),
    setCompleted: (value: "all" | "completed" | "incomplete" | "default") => setFilterValue('completed', value),
    setPriority: (value: number[]) => setFilterValue('priority', value),
    setAssignee: (value: string[]) => setFilterValue('assignee', value),
    setDueDate: (value: "all" | "overdue" | "today" | "tomorrow" | "this_week" | "this_month" | "this_calendar_week" | "this_calendar_month" | "no_date") => setFilterValue('dueDate', value),
    setSortBy: (value: FilterState['sortBy']) => setFilterValue('sortBy', value),
    
    // Actions
    clearAllFilters,
    applyFiltersToTasks,
    
    // Meta
    isMyTasks
  }
}
