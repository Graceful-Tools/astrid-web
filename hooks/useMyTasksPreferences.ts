/**
 * My Tasks Preferences Hook
 *
 * Manages My Tasks filter preferences synced across devices via database + SSE.
 * This replaces localStorage-based persistence with server-side sync.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useSSESubscription } from './use-sse-subscription'
import type { MyTasksPreferences } from '@/app/api/v1/users/me/my-tasks-preferences/route'

const DEFAULT_PREFERENCES: MyTasksPreferences = {
  filterPriority: [],
  filterAssignee: [],
  filterDueDate: 'all',
  filterCompletion: 'default',
  sortBy: 'auto',
  manualSortOrder: [],
}

export function useMyTasksPreferences() {
  const [preferences, setPreferences] = useState<MyTasksPreferences>(DEFAULT_PREFERENCES)
  const [isLoading, setIsLoading] = useState(true)
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)


  // Fetch initial preferences from API
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('/api/v1/users/me/my-tasks-preferences')
        if (response.ok) {
          const data = await response.json()
          setPreferences(data)
        }
      } catch (error) {
        console.error('Failed to fetch My Tasks preferences:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchPreferences()
  }, [])

  // Listen for SSE updates from other devices/sessions
  useSSESubscription(
    'my_tasks_preferences_updated',
    useCallback((event) => {
      if (event.data) {
        setPreferences(event.data)
      }
    }, []),
    { componentName: 'MyTasksPreferences' }
  )

  // Update preferences on server with debouncing
  const updatePreferences = useCallback(async (updates: Partial<MyTasksPreferences>) => {
    // Optimistically update local state
    setPreferences(prev => ({ ...prev, ...updates }))

    // Debounce API call (300ms)
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }

    updateTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/users/me/my-tasks-preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })

        if (!response.ok) {
          console.error('[MyTasksPrefs] Failed to update preferences:', response.status)
        }
      } catch (error) {
        console.error('[MyTasksPrefs] Error updating preferences:', error)
      }
    }, 300)
  }, [])

  // Individual setters
  const setFilterPriority = useCallback((value: number[]) => {
    updatePreferences({ filterPriority: value })
  }, [updatePreferences])

  const setFilterAssignee = useCallback((value: string[]) => {
    updatePreferences({ filterAssignee: value })
  }, [updatePreferences])

  const setFilterDueDate = useCallback((value: string) => {
    updatePreferences({ filterDueDate: value })
  }, [updatePreferences])

  const setFilterCompletion = useCallback((value: string) => {
    updatePreferences({ filterCompletion: value })
  }, [updatePreferences])

  const setSortBy = useCallback((value: string) => {
    updatePreferences({ sortBy: value })
  }, [updatePreferences])

  const setManualSortOrder = useCallback((value: string[]) => {
    updatePreferences({ manualSortOrder: value })
  }, [updatePreferences])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    updatePreferences(DEFAULT_PREFERENCES)
  }, [updatePreferences])

  // Check if any filters are active
  const hasActiveFilters =
    preferences.filterCompletion !== "default" ||
    preferences.filterDueDate !== "all" ||
    (preferences.filterPriority?.length ?? 0) > 0 ||
    (preferences.filterAssignee?.length ?? 0) > 0 ||
    preferences.sortBy !== "auto"

  // Memoized filter values
  const filters = useMemo(() => ({
    priority: preferences.filterPriority ?? [],
    assignee: preferences.filterAssignee ?? [],
    dueDate: preferences.filterDueDate ?? 'all',
    completion: preferences.filterCompletion ?? 'default',
    sortBy: preferences.sortBy ?? 'auto',
    manualSortOrder: preferences.manualSortOrder ?? []
  }), [preferences])

  // Memoized setters
  const setters = useMemo(() => ({
    setFilterPriority,
    setFilterAssignee,
    setFilterDueDate,
    setFilterCompletion,
    setSortBy,
    setManualSortOrder
  }), [setFilterPriority, setFilterAssignee, setFilterDueDate, setFilterCompletion, setSortBy, setManualSortOrder])

  return {
    filters,
    setters,
    hasActiveFilters,
    clearAllFilters,
    isLoading
  }
}
