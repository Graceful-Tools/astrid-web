import { useState, useCallback, useRef, useMemo } from "react"
import type { Task } from "@/types/task"

/**
 * Navigate to a task with proper scrolling and element tracking.
 * Shared logic for keyboard navigation (up/down arrow keys).
 */
function navigateToTask(
  taskId: string,
  setSelectedTaskId: (id: string) => void,
  setSelectedTaskElement: (el: HTMLElement | null) => void,
  setSelectedTaskRect: (rect: DOMRect | null) => void,
  isKeyboardScrollingRef: React.MutableRefObject<boolean>
): void {
  setSelectedTaskId(taskId)

  // Clear hover state from all task rows
  document.querySelectorAll('[data-task-id]').forEach(el => {
    if (el instanceof HTMLElement) {
      el.style.pointerEvents = 'none'
      setTimeout(() => { el.style.pointerEvents = '' }, 0)
    }
  })

  // Find and update the task element for arrow positioning
  // Use double RAF to ensure DOM is fully updated and painted
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const taskElement = document.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement
      if (taskElement) {
        setSelectedTaskElement(taskElement)
        setSelectedTaskRect(taskElement.getBoundingClientRect())

        // Set flag before scrolling to prevent scroll handler from closing task
        isKeyboardScrollingRef.current = true

        // Scroll the selected task into view
        taskElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest'
        })

        // Clear flag after scroll animation completes
        setTimeout(() => {
          isKeyboardScrollingRef.current = false
        }, 500)
      }
    })
  })
}

export interface UseTaskSelectionProps {
  initialSelectedTaskId?: string
  finalFilteredTasks: Task[]
  isMobile: boolean
  selectedListId: string
  finalTasks: Task[]
  closeTaskPaneAnimated: () => void
  setMobileView?: (view: 'list' | 'task' | 'chat') => void
  setShowMobileSidebar?: (show: boolean) => void
}

export interface UseTaskSelectionReturn {
  // State
  selectedTaskId: string
  selectedTaskElement: HTMLElement | null
  selectedTaskRect: DOMRect | null
  isKeyboardScrollingRef: React.MutableRefObject<boolean>
  selectedTask: Task | undefined

  // State setters
  setSelectedTaskId: (id: string) => void
  setSelectedTaskElement: (el: HTMLElement | null) => void
  setSelectedTaskRect: (rect: DOMRect | null) => void

  // Handlers
  handleTaskClick: (taskId: string, taskElement?: HTMLElement) => void
  handleSelectNextTask: () => void
  handleSelectPreviousTask: () => void
}

export function useTaskSelection({
  initialSelectedTaskId,
  finalFilteredTasks,
  isMobile,
  selectedListId,
  finalTasks,
  closeTaskPaneAnimated,
  setMobileView,
  setShowMobileSidebar
}: UseTaskSelectionProps): UseTaskSelectionReturn {
  // Selection state
  const [selectedTaskIdState, setSelectedTaskIdState] = useState<string>(initialSelectedTaskId || "")
  const [selectedTaskElement, setSelectedTaskElement] = useState<HTMLElement | null>(null)
  const [selectedTaskRect, setSelectedTaskRect] = useState<DOMRect | null>(null)
  const isKeyboardScrollingRef = useRef(false)

  // Stable setter reference
  const setSelectedTaskId = setSelectedTaskIdState
  const selectedTaskId = selectedTaskIdState

  // Safe mobile view setter
  const setMobileViewSafe = useCallback((view: 'list' | 'task' | 'chat') => {
    if (setMobileView) {
      setMobileView(view)
    }
  }, [setMobileView])

  // Get selected task from finalTasks
  const selectedTask = useMemo(() => {
    const task = finalTasks.find((task: Task) => task.id === selectedTaskId)
    if (process.env.NODE_ENV === 'development' && selectedTaskId && !task) {
      console.log('[useTaskSelection] selectedTask computation - TASK NOT FOUND:', {
        selectedTaskId,
        finalTasksCount: finalTasks.length,
        isOptimisticId: selectedTaskId.startsWith('temp-')
      })
    }
    return task
  }, [finalTasks, selectedTaskId])

  // Task click handler
  const handleTaskClick = useCallback((taskId: string, taskElement?: HTMLElement) => {
    // Close mobile sidebar when task is clicked
    setShowMobileSidebar?.(false)

    // Find the task to determine its primary list for URL construction
    const task = finalTasks.find(t => t.id === taskId)

    // Toggle task selection: if same task is clicked, close it
    if (selectedTaskId === taskId) {
      closeTaskPaneAnimated()
      if (isMobile) {
        setMobileViewSafe('list')
      }
      // Update URL without navigation (remove task query param)
      if (task && task.lists && task.lists.length > 0) {
        const primaryListId = task.lists[0].id
        window.history.replaceState(null, '', `/lists/${primaryListId}`)
      } else if (selectedListId !== "my-tasks") {
        window.history.replaceState(null, '', `/lists/${selectedListId}`)
      } else {
        window.history.replaceState(null, '', '/')
      }
      return
    }

    // Always update state immediately for smooth UX
    setSelectedTaskId(taskId)

    // Store the task element for positioning
    if (taskElement) {
      setSelectedTaskElement(taskElement)
      setSelectedTaskRect(taskElement.getBoundingClientRect())
    }

    // Update URL based on current list context, don't change lists
    if (selectedListId !== "my-tasks") {
      // Stay in current list, just add task parameter
      window.history.replaceState(null, '', `/lists/${selectedListId}?task=${taskId}`)
    } else {
      // For my-tasks, use home URL with task parameter
      window.history.replaceState(null, '', `/?task=${taskId}`)
    }

    // On mobile, switch to task view
    if (isMobile) {
      setMobileViewSafe('task')
    }
  }, [
    selectedTaskId,
    isMobile,
    setMobileViewSafe,
    closeTaskPaneAnimated,
    finalTasks,
    selectedListId,
    setSelectedTaskId,
    setSelectedTaskElement,
    setSelectedTaskRect,
    setShowMobileSidebar
  ])

  // Keyboard navigation handlers
  const handleSelectNextTask = useCallback(() => {
    if (!finalFilteredTasks.length) return
    const currentIndex = finalFilteredTasks.findIndex(task => task.id === selectedTaskId)
    const nextIndex = currentIndex < finalFilteredTasks.length - 1 ? currentIndex + 1 : 0
    const nextTask = finalFilteredTasks[nextIndex]
    if (nextTask) {
      navigateToTask(nextTask.id, setSelectedTaskId, setSelectedTaskElement, setSelectedTaskRect, isKeyboardScrollingRef)
    }
  }, [finalFilteredTasks, selectedTaskId, setSelectedTaskId])

  const handleSelectPreviousTask = useCallback(() => {
    if (!finalFilteredTasks.length) return
    const currentIndex = finalFilteredTasks.findIndex(task => task.id === selectedTaskId)
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : finalFilteredTasks.length - 1
    const prevTask = finalFilteredTasks[prevIndex]
    if (prevTask) {
      navigateToTask(prevTask.id, setSelectedTaskId, setSelectedTaskElement, setSelectedTaskRect, isKeyboardScrollingRef)
    }
  }, [finalFilteredTasks, selectedTaskId, setSelectedTaskId])

  return {
    // State
    selectedTaskId,
    selectedTaskElement,
    selectedTaskRect,
    isKeyboardScrollingRef,
    selectedTask,

    // State setters
    setSelectedTaskId,
    setSelectedTaskElement,
    setSelectedTaskRect,

    // Handlers
    handleTaskClick,
    handleSelectNextTask,
    handleSelectPreviousTask
  }
}
