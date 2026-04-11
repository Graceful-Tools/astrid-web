import { useState, useCallback, useEffect, useRef } from "react"
import type { Task, TaskList } from "@/types/task"

export interface UseTaskNavigationProps {
  initialSelectedListId?: string
  initialSettingsPage?: string
  isMobile: boolean
  setMobileView?: (view: 'list' | 'task' | 'chat') => void
  initialSelectedTaskId?: string
  loading: boolean
  tasks: Task[]
  selectedTaskId: string
  setSelectedTaskId: (id: string) => void
}

export interface UseTaskNavigationReturn {
  // List selection state
  selectedListId: string
  isViewingFromFeatured: boolean
  recentlyChangedList: boolean

  // Unified view state
  activeView: 'list' | 'settings' | 'search'
  settingsPage: string | null
  isSettingsActive: boolean
  settingsSubPage: string | null
  isSearchActive: boolean
  navigateToSettings: (page: string) => void
  exitSettings: () => void
  closeSettingsSubPage: () => void
  selectSearch: () => void
  exitSearch: () => void

  // List selection setters and handlers
  setSelectedListId: (listId: string, fromFeatured?: boolean) => void
  setRecentlyChangedList: React.Dispatch<React.SetStateAction<boolean>>

  // Navigation helpers
  setMobileViewSafe: (view: 'list' | 'task' | 'chat') => void
}

export function useTaskNavigation({
  initialSelectedListId,
  initialSettingsPage,
  isMobile,
  setMobileView,
  initialSelectedTaskId,
  loading,
  tasks,
  selectedTaskId,
  setSelectedTaskId
}: UseTaskNavigationProps): UseTaskNavigationReturn {
  // List selection state
  const [selectedListId, setSelectedListIdState] = useState<string>(initialSelectedListId || "my-tasks")
  const [isViewingFromFeatured, setIsViewingFromFeatured] = useState(false)
  const [recentlyChangedList, setRecentlyChangedList] = useState(false)

  // Settings and search navigation state
  const [settingsPage, setSettingsPage] = useState<string | null>(initialSettingsPage || null)
  const [isSearchActive, setIsSearchActive] = useState(false)

  // Derived unified view
  const activeView: 'list' | 'settings' | 'search' = settingsPage
    ? 'settings'
    : isSearchActive
      ? 'search'
      : 'list'
  const isSettingsActive = settingsPage !== null
  const settingsSubPage = (settingsPage && settingsPage !== 'hub') ? settingsPage : null

  const navigateToSettings = useCallback((page: string) => {
    setSettingsPage(page)
    setIsSearchActive(false)
    setSelectedTaskId("")
    const url = page === 'hub' ? '/settings' : `/settings/${page}`
    window.history.pushState(null, '', url)
  }, [setSelectedTaskId])

  const exitSettings = useCallback(() => {
    setSettingsPage(null)
    const url = selectedListId === 'my-tasks' ? '/' : `/lists/${selectedListId}`
    window.history.pushState(null, '', url)
  }, [selectedListId])

  const closeSettingsSubPage = useCallback(() => {
    setSettingsPage('hub')
    window.history.pushState(null, '', '/settings')
  }, [])

  const selectSearch = useCallback(() => {
    setIsSearchActive(true)
    setSettingsPage(null)
    setSelectedTaskId("")
    // Ensure we're on my-tasks so MainContent renders the full task list for searching
    setSelectedListIdState("my-tasks")
  }, [setSelectedTaskId])

  const exitSearch = useCallback(() => {
    setIsSearchActive(false)
  }, [])

  // Handle browser back/forward for settings and search
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname
      const cleanPath = path.replace(/^\/[a-z]{2}(?=\/)/, '')
      if (cleanPath === '/settings') {
        setSettingsPage('hub')
        setIsSearchActive(false)
      } else if (cleanPath.startsWith('/settings/')) {
        setSettingsPage(cleanPath.replace('/settings/', ''))
        setIsSearchActive(false)
      } else {
        setSettingsPage(null)
        setIsSearchActive(false)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Enhanced setSelectedListId that tracks navigation source and clears other views
  const setSelectedListId = useCallback((listId: string, fromFeatured?: boolean) => {
    setSelectedListIdState(listId)
    setIsViewingFromFeatured(fromFeatured ?? false)
    setSettingsPage(null)
    setIsSearchActive(false)
  }, [])

  // Safe mobile view setter
  const setMobileViewSafe = useCallback((view: 'list' | 'task' | 'chat') => {
    if (setMobileView) {
      setMobileView(view)
    }
  }, [setMobileView])

  // Auto-open task detail when initialSelectedTaskId is provided
  useEffect(() => {
    // Only run if we have an initialSelectedTaskId and tasks have loaded
    if (!initialSelectedTaskId || loading || tasks.length === 0) {
      return
    }

    // Check if the task exists in our loaded tasks
    const taskExists = tasks.some(t => t.id === initialSelectedTaskId)

    if (taskExists) {
      // Only auto-open if not already selected (prevent loops)
      if (selectedTaskId !== initialSelectedTaskId) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskNavigation] Auto-opening task from URL:', {
            taskId: initialSelectedTaskId,
            isMobile: isMobile,
            tasksCount: tasks.length
          })
        }

        // Set the selected task ID first
        setSelectedTaskId(initialSelectedTaskId)

        // On mobile, switch to task view immediately
        if (isMobile) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[useTaskNavigation] Switching to task view on mobile')
          }
          requestAnimationFrame(() => {
            setMobileViewSafe('task')
          })
        }
      }
    } else {
      // Task doesn't exist in loaded tasks
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useTaskNavigation] Task from URL not found in loaded tasks:', initialSelectedTaskId)
      }
    }
  }, [initialSelectedTaskId, loading, tasks, selectedTaskId, isMobile, setMobileViewSafe, setSelectedTaskId])

  // Close task details when switching lists
  const previousSelectedListId = useRef(selectedListId)
  useEffect(() => {
    if (previousSelectedListId.current !== selectedListId && selectedTaskId) {
      setSelectedTaskId("")
    }
    previousSelectedListId.current = selectedListId
  }, [selectedListId, selectedTaskId, setSelectedTaskId])

  return {
    // List selection state
    selectedListId,
    isViewingFromFeatured,
    recentlyChangedList,

    // Unified view state
    activeView,
    settingsPage,
    isSettingsActive,
    settingsSubPage,
    isSearchActive,
    navigateToSettings,
    exitSettings,
    closeSettingsSubPage,
    selectSearch,
    exitSearch,

    // List selection setters and handlers
    setSelectedListId,
    setRecentlyChangedList,

    // Navigation helpers
    setMobileViewSafe
  }
}
