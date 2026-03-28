import { useState, useCallback, useEffect, useRef } from "react"
import type { Task, TaskList } from "@/types/task"

export interface UseTaskNavigationProps {
  initialSelectedListId?: string
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

  // List selection setters and handlers
  setSelectedListId: (listId: string, fromFeatured?: boolean) => void
  setRecentlyChangedList: React.Dispatch<React.SetStateAction<boolean>>

  // Navigation helpers
  setMobileViewSafe: (view: 'list' | 'task' | 'chat') => void
}

export function useTaskNavigation({
  initialSelectedListId,
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

  // Enhanced setSelectedListId that tracks navigation source
  const setSelectedListId = useCallback((listId: string, fromFeatured?: boolean) => {
    setSelectedListIdState(listId)
    // If explicitly set, use that value. Otherwise, reset to false when changing lists
    setIsViewingFromFeatured(fromFeatured ?? false)
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

    // List selection setters and handlers
    setSelectedListId,
    setRecentlyChangedList,

    // Navigation helpers
    setMobileViewSafe
  }
}
