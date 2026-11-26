import { useState, useCallback, useMemo, useEffect } from 'react'
import { useMyTasksPreferences } from './useMyTasksPreferences'
import type { Task, TaskList } from '@/types/task'
import { usePolicyEstimates } from '@/hooks/use-policy-estimates'
import { hasListAccess } from '@/lib/list-member-utils'
import { applyDateFilter, coreDueDateWindow, type DueDateWindow } from '@/lib/date-filter-utils'
import { sortTasksForList } from '@/lib/task-sort'
import { browserCoreRules, browserRowsCore } from '@/lib/core-rules/browser'
import { isInMyTasksScope, matchesAssigneeFilter, matchesPriorityFilter } from '@/lib/my-tasks-scope'
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
  dueDate: DueDateWindow
  sortBy: "auto" | "priority" | "when" | "completedAt" | "manual" | "policy"
}

interface UseFilterStateProps {
  selectedListId: string
  currentList?: TaskList
  getManualOrder?: (listId: string) => string[] | undefined
  /** Resolves a saved `current_user` assignee filter. */
  currentUserId?: string | null
}

/** A list's saved priority ("all" | "0".."3") as the live filter (task ADEV-91). */
export const savedPriorityFilter = (value?: string | null): number[] => {
  // "all" and other words are NaN; the empty string would read as 0.
  const n = Number(value)
  return value && n >= 0 && n <= 3 && n % 1 === 0 ? [n] : []
}

/**
 * A list's saved assignee as the live filter (task ADEV-91). `not_current_user` has no
 * list-of-ids form and, like a `current_user` with nobody signed in, stays unfiltered.
 */
export const savedAssigneeFilter = (value?: string | null, currentUserId?: string | null): string[] => {
  if (!value || value === "all" || value === "not_current_user") return []
  if (value === "current_user") return currentUserId ? [currentUserId] : []
  return [value]
}

export const savedDueDateFilter = (value?: string | null): DueDateWindow =>
  coreDueDateWindow(value || "all") as DueDateWindow

const getValidSortBy = (value?: string | null): FilterState['sortBy'] => {
  switch (value) {
    case "priority":
    case "when":
    case "completedAt":
    case "manual":
    case "policy":
      return value
    // "assignee", "completed" and "incomplete" were web-only orders, retired in AWTD-1583
    // (astrid-core D33): a list that saved one sorts as auto, which is what every other client
    // did with it, and the default below says so.
    // Legacy support: convert old "due_date" to "when"
    case "due_date":
      return "when"
    default:
      return "auto"
  }
}

// Ensures filterCompletion is a valid value.
const getValidFilterCompletion = (value?: string | null): "all" | "completed" | "incomplete" | "default" => {
  if (value === "all" || value === "completed" || value === "incomplete" || value === "default") {
    return value
  }
  return "default" // Changed from "incomplete" to make "default" the new default
}

export const useFilterState = ({ selectedListId, currentList, getManualOrder, currentUserId }: UseFilterStateProps) => {
  // Each task's stored trade-off label and sort key, for the `policy` sort (ADEV-281). The bulk task
  // sync does not carry them (lib/tasks/v1-task-estimate.ts), so they are fetched only while the open
  // list is saved as sorted by policy. Until they arrive every task is unlabelled and `policy` reads as auto.
  const policyEstimates = usePolicyEstimates(currentList?.sortBy === "policy" ? currentList.id : null)

  // The list's saved priority, assignee and due date as live filters (task ADEV-91), read once
  // per change of the saved primitives and shared by the initial state, the load effects, Clear
  // and the core rows request.
  const saved = useMemo(
    () => ({
      priority: savedPriorityFilter(currentList?.filterPriority),
      assignee: savedAssigneeFilter(currentList?.filterAssignee, currentUserId),
      dueDate: savedDueDateFilter(currentList?.filterDueDate),
    }),
    [currentList?.filterPriority, currentList?.filterAssignee, currentList?.filterDueDate, currentUserId],
  )

  // Regular filter state (not persisted)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterCompleted, setFilterCompleted] = useState<"all" | "completed" | "incomplete" | "default">(
    getValidFilterCompletion(currentList?.filterCompletion)
  )
  const [filterPriority, setFilterPriority] = useState<number[]>(saved.priority)
  const [filterAssignee, setFilterAssignee] = useState<string[]>(saved.assignee)
  const [filterDueDate, setFilterDueDate] = useState<DueDateWindow>(saved.dueDate)
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
  
  // The saved priority, assignee and due date load the same way, so web draws a list as iOS and
  // the Mac do through core `rows` (task ADEV-91). `saved` is keyed on their primitives.
  useEffect(() => {
    if (currentList && !isMyTasks) {
      setFilterPriority(saved.priority)
      setFilterAssignee(saved.assignee)
      setFilterDueDate(saved.dueDate)
    }
  }, [currentList?.id, saved, isMyTasks])

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
          setFilterCompleted(value)
          break
        case 'priority':
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
      setFilterPriority(saved.priority)
      setFilterAssignee(saved.assignee)
      setFilterDueDate(saved.dueDate)
      setSortBy("auto")
    }
  }, [isMyTasks, myTasksPreferences, currentList, saved])

  const applyFiltersToTasks = useCallback((tasks: Task[], userId?: string, lists?: TaskList[], skipListFiltering = false, skipVirtualListFilters = false, serverSearchApplied = false): Task[] => {
    // The policy sort compares each task's stored key, which the sync does not carry (ADEV-281).
    const stored = activeFilters.sortBy === "policy" ? policyEstimates : null
    let filtered = stored?.size
      ? tasks.map(task => {
          const estimate = task.estimate ?? stored.get(task.id)
          return estimate ? { ...task, estimate } : task
        })
      : [...tasks]


    // Check if we have an active search - if so, search universally across all accessible tasks
    const isUniversalSearch = activeFilters.search.trim().length > 0
    
    // The candidates core's rows door is handed for a saved view (AWTD-1663): the list's members.
    let members: Task[] | null = null

    // FIRST: Apply list membership filter - this is crucial! (unless skipping or doing universal search)
    if (!skipListFiltering && !isUniversalSearch) {
      const currentList = lists?.find(l => l.id === selectedListId)
      
      if (selectedListId === "my-tasks") {
        // lib/my-tasks-scope.ts — pure so the contract fixtures can run it (AWTD-1262)
        filtered = filtered.filter(task => isInMyTasksScope(task, userId))
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
          members = filtered
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
      filtered = filtered.filter(task => matchesPriorityFilter(task, activeFilters.priority))
    }

    // Assignee filter (always apply unless we know the virtual list already handled it).
    // Not in My Tasks, which is already only what is assigned to you and does not read it
    // (lib/my-tasks-scope.ts, AWTD-1583 / astrid-core D25).
    if (activeFilters.assignee.length > 0 && selectedListId !== "my-tasks") {
      filtered = filtered.filter(task => matchesAssigneeFilter(task, activeFilters.assignee))
    }

    // Due date filter (always apply unless we know the virtual list already handled it)
    if (activeFilters.dueDate !== "all") {
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

    // A saved view is ordered by astrid-core's rows door once the browser has loaded it
    // (AWTD-1663): the same order iOS and the Mac draw. Core only reorders — a different set of
    // tasks from the TypeScript's keeps the TypeScript's list (lib/core-rules/rows-core.ts).
    const door = browserCoreRules()
    const rows = browserRowsCore()
    if (door?.answers('rows') && rows && !skipListFiltering && !serverSearchApplied) {
      const view = rows.savedViewFor({
        selectedListId,
        currentList,
        filters: activeFilters,
        savedCompletion: getValidFilterCompletion(currentList?.filterCompletion),
        savedSortBy: getValidSortBy(currentList?.sortBy),
        saved,
        manualOrder: activeFilters.sortBy === "manual" ? getManualOrder?.(selectedListId) : undefined,
      })
      const candidates = view?.kind === 'myTasks' ? tasks : members
      if (view && candidates) {
        const ids = rows.coreOrderedIds({ runJson: door.runJson, view, candidates, lists: lists ?? [], currentUserId: userId, now: new Date() })
        return rows.orderLikeCore(sortedTasks, ids)
      }
    }

    return sortedTasks
  }, [activeFilters, selectedListId, currentList, getManualOrder, saved, policyEstimates])

  return {
    // Current filter values
    filters: activeFilters,
    hasActiveFilters,
    
    // Filter setters
    setSearch: (value: string) => setFilterValue('search', value),
    setCompleted: (value: "all" | "completed" | "incomplete" | "default") => setFilterValue('completed', value),
    setPriority: (value: number[]) => setFilterValue('priority', value),
    setAssignee: (value: string[]) => setFilterValue('assignee', value),
    setDueDate: (value: DueDateWindow) => setFilterValue('dueDate', value),
    setSortBy: (value: FilterState['sortBy']) => setFilterValue('sortBy', value),
    
    // Actions
    clearAllFilters,
    applyFiltersToTasks,
    
    // Meta
    isMyTasks
  }
}
