import { useEffect, useCallback, useState } from "react"
import type { Task } from "@/types/task"

export interface KeyboardShortcutHandlers {
  // Navigation
  onSelectNextTask: () => void
  onSelectPreviousTask: () => void
  onToggleTaskPanel: () => void
  onCycleListFilters: () => void
  onJumpToDate: () => void

  // Task actions
  onNewTask: () => void
  onCompleteTask: () => void
  onDeleteTask: () => void
  onPostponeTask: () => void
  onRemoveDueDate: () => void
  onSetPriority: (priority: 0 | 1 | 2 | 3) => void
  onMakeDueDateEarlier: () => void
  onMakeDueDateLater: () => void

  // Task editing
  onEditTaskLists: () => void
  onEditTaskTitle: () => void
  onEditTaskDescription: () => void
  onAddTaskComment: () => void
  onAssignToNoOne: () => void

  // UI
  onShowHotkeyMenu: () => void
}

interface UseKeyboardShortcutsProps {
  handlers: KeyboardShortcutHandlers
  selectedTask?: Task | null
  isEnabled?: boolean
  isInputFocused?: boolean
}

export const KEYBOARD_SHORTCUTS = [
  { key: "n", description: "New task", action: "onNewTask" },
  { key: "x", description: "Complete selected task", action: "onCompleteTask" },
  { key: "←", description: "Make due date one day earlier", action: "onMakeDueDateEarlier" },
  { key: "→", description: "Make due date one day later", action: "onMakeDueDateLater" },
  { key: "d", description: "Jump to 'Date'", action: "onJumpToDate" },
  { key: "p", description: "Postpone task by one week", action: "onPostponeTask" },
  { key: "v", description: "Remove task due date", action: "onRemoveDueDate" },
  { key: "i", description: "Edit task lists", action: "onEditTaskLists" },
  { key: "t", description: "Edit task title", action: "onEditTaskTitle" },
  { key: "s", description: "Edit task description", action: "onEditTaskDescription" },
  { key: "c", description: "Add a new task comment", action: "onAddTaskComment" },
  { key: "e", description: "Assign task to 'No One'", action: "onAssignToNoOne" },
  { key: "0", description: "Set priority to ○ (None)", action: "onSetPriority", param: 0 },
  { key: "1", description: "Set priority to ! (Low)", action: "onSetPriority", param: 1 },
  { key: "2", description: "Set priority to !! (Medium)", action: "onSetPriority", param: 2 },
  { key: "3", description: "Set priority to !!! (High)", action: "onSetPriority", param: 3 },
  { key: "Delete", description: "Delete selected task", action: "onDeleteTask" },
  { key: "Backspace", description: "Delete selected task (alternative)", action: "onDeleteTask" },
  { key: "o", description: "Open/close task edit panel", action: "onToggleTaskPanel" },
  { key: "l", description: "Cycle through list filters/tags", action: "onCycleListFilters" },
  { key: "k", description: "Select previous task", action: "onSelectPreviousTask" },
  { key: "j", description: "Select next task", action: "onSelectNextTask" },
  { key: "↑", description: "Select previous task", action: "onSelectPreviousTask" },
  { key: "↓", description: "Select next task", action: "onSelectNextTask" },
  { key: "?", description: "Show hotkey listing", action: "onShowHotkeyMenu" },
] as const

export function useKeyboardShortcuts({
  handlers,
  selectedTask,
  isEnabled = true,
  isInputFocused = false
}: UseKeyboardShortcutsProps) {
  const [showHotkeyMenu, setShowHotkeyMenu] = useState(false)

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't handle shortcuts if disabled or if user is typing in an input
    if (!isEnabled || isInputFocused) return

    // Don't handle shortcuts if user is typing in an input/textarea/contenteditable,
    // or if focus is inside an open modal/dialog — otherwise keys like "d" or "n"
    // pressed while interacting with a modal (even on a focused Button) would fire
    // the global shortcut and navigate away from the user's current context.
    const activeElement = document.activeElement as HTMLElement | null
    if (
      activeElement?.tagName === 'INPUT' ||
      activeElement?.tagName === 'TEXTAREA' ||
      activeElement?.getAttribute('contenteditable') === 'true' ||
      activeElement?.closest('[role="dialog"]')
    ) {
      return
    }

    const key = event.key
    const isShiftPressed = event.shiftKey
    const isCtrlPressed = event.ctrlKey || event.metaKey

    // Ignore if modifier keys are pressed (except for arrow keys and specific combinations)
    if ((isCtrlPressed || isShiftPressed) && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
      return
    }

    switch (key) {
      case 'n':
        event.preventDefault()
        handlers.onNewTask()
        break

      case 'x':
        if (selectedTask) {
          event.preventDefault()
          handlers.onCompleteTask()
        }
        break

      case 'ArrowLeft':
        if (selectedTask) {
          event.preventDefault()
          handlers.onMakeDueDateEarlier()
        }
        break

      case 'ArrowRight':
        if (selectedTask) {
          event.preventDefault()
          handlers.onMakeDueDateLater()
        }
        break

      case 'd':
        event.preventDefault()
        handlers.onJumpToDate()
        break

      case 'p':
        if (selectedTask) {
          event.preventDefault()
          handlers.onPostponeTask()
        }
        break

      case 'v':
        if (selectedTask) {
          event.preventDefault()
          handlers.onRemoveDueDate()
        }
        break

      case 'i':
        if (selectedTask) {
          event.preventDefault()
          handlers.onEditTaskLists()
        }
        break

      case 't':
        if (selectedTask) {
          event.preventDefault()
          handlers.onEditTaskTitle()
        }
        break

      case 's':
        if (selectedTask) {
          event.preventDefault()
          handlers.onEditTaskDescription()
        }
        break

      case 'c':
        if (selectedTask) {
          event.preventDefault()
          handlers.onAddTaskComment()
        }
        break

      case 'e':
        if (selectedTask) {
          event.preventDefault()
          handlers.onAssignToNoOne()
        }
        break

      case '0':
        if (selectedTask) {
          event.preventDefault()
          handlers.onSetPriority(0)
        }
        break

      case '1':
        if (selectedTask) {
          event.preventDefault()
          handlers.onSetPriority(1)
        }
        break

      case '2':
        if (selectedTask) {
          event.preventDefault()
          handlers.onSetPriority(2)
        }
        break

      case '3':
        if (selectedTask) {
          event.preventDefault()
          handlers.onSetPriority(3)
        }
        break

      case 'Delete':
      case 'Backspace':
        if (selectedTask) {
          event.preventDefault()
          handlers.onDeleteTask()
        }
        break

      case 'o':
        event.preventDefault()
        handlers.onToggleTaskPanel()
        break

      case 'l':
        event.preventDefault()
        handlers.onCycleListFilters()
        break

      case 'k':
      case 'ArrowUp':
        event.preventDefault()
        handlers.onSelectPreviousTask()
        break

      case 'j':
      case 'ArrowDown':
        event.preventDefault()
        handlers.onSelectNextTask()
        break

      case '?':
        event.preventDefault()
        setShowHotkeyMenu(true)
        handlers.onShowHotkeyMenu()
        break
    }
  }, [handlers, selectedTask, isEnabled, isInputFocused])

  useEffect(() => {
    if (isEnabled) {
      document.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [handleKeyDown, isEnabled])

  return {
    showHotkeyMenu,
    setShowHotkeyMenu,
    shortcuts: KEYBOARD_SHORTCUTS
  }
}