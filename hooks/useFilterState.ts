import { useState, useCallback, useMemo, useEffect } from 'react'
import { useMyTasksPreferences } from './useMyTasksPreferences'
import type { Task, TaskList } from '@/types/task'
import { hasListAccess } from '@/lib/list-member-utils'
import { applyDateFilter } from '@/lib/date-filter-utils'
import { sortTasksForList } from '@/lib/task-sort'
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
  sortBy: "auto" | "priority" | "when" | "assignee" | "completed" | "incomplete" | "completedAt" | "manual"
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
    case "completedAt":
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

  // Load a list's saved completion/sort defaults when you switch lists or when
  // the list's saved default actually changes. Keyed on the primitive values —
  // NOT the currentList object — because currentList is `lists.find(...)`, which
  // returns a new reference on every task update / SSE push / refetch. Depending
  // on the object reference re-fired these effects on every refetch and reset
  // the user's in-session filter back to the list default (task 61ecf56b — the
  // "filter resets back to All tasks" bug).
   
  useEffect(() => {
    if (currentList && !isMyTasks) {
      setFilterCompleted(getValidFilterCompletion(currentList.filterCompletion))
    }
  }, [currentList?.id, currentList?.filterCompletion, isMyTasks])

   
  useEffect(() => {
    if (currentList && !isMyTasks) {
      setSortBy(getValidSortBy(currentList.sortBy))
    }
  }, [currentList?.id, currentList?.sortBy, isMyTasks])
  
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

  const applyFiltersToTasks = useCallback((tasks: Task[], userId?: string, lists?: TaskList[], skipListFiltering = false, skipVirtualListFilters = false, serverSearchApplied = false): Task[] => {
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
    } else if (isUniversalSearch && !serverSearchApplied) {
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
    if (activeFilters.search.trim() && !serverSearchApplied) {
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

    // Sorting lives in lib/task-sort.ts — one comparator for every surface.
    // This hook used to carry a byte-for-byte copy of the switch (and of the
    // manual-order fallback), which meant a new sort option had to be written
    // twice or silently miss a surface. The completedAt option is when the
    // duplicate finally bit.
    const sortedTasks = sortTasksForList(
      filtered,
      activeFilters.sortBy,
      activeFilters.sortBy === "manual" ? getManualOrder?.(selectedListId) ?? [] : undefined,
    )

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
