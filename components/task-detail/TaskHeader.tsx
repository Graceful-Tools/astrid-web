import { Button } from "@/components/ui/button"
import { TaskCheckbox } from "../task-checkbox"
import { TaskActionMenu } from "./TaskActionMenu"
import type { Task, User } from "../../types/task"

/**
 * Task detail header section: optional mobile back button, completion
 * checkbox, title editor, and the action menu (...).
 *
 * Extracted from task-detail.tsx as the second god-component split.
 * Behavior unchanged — same DOM structure, same auto-resize textarea, same
 * Enter/Escape keyboard handling, same conditional rendering for the back
 * button (only when onClose is provided).
 */
interface TaskHeaderProps {
  task: Task
  currentUser: User
  onClose?: () => void
  // Title editing state from useTaskDetailState (parent owns it)
  tempCompleted: boolean
  tempTitle: string
  editingTitle: boolean
  setTempTitle: (s: string) => void
  setEditingTitle: (b: boolean) => void
  onToggleComplete: () => void
  onSaveTitle: () => void
  onCancelTitle: () => void
  // Action menu pass-through
  reminderDebugMode: boolean
  onCopy: () => void
  onShare: () => void
  onDelete: () => void
  onTestReminder: () => void
}

export function TaskHeader({
  task,
  currentUser,
  onClose,
  tempCompleted,
  tempTitle,
  editingTitle,
  setTempTitle,
  setEditingTitle,
  onToggleComplete,
  onSaveTitle,
  onCancelTitle,
  reminderDebugMode,
  onCopy,
  onShare,
  onDelete,
  onTestReminder,
}: TaskHeaderProps) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Top header bar: back (mobile/tablet), "Task Details" label, action menu */}
      <div className="theme-header theme-border relative flex items-center px-2 py-2 min-h-[44px]">
        {onClose ? (
          <Button
            variant="ghost"
            onClick={onClose}
            className="cols2:hidden flex items-center theme-text-primary hover:theme-text-secondary rounded-md hover:theme-bg-hover px-2 py-1 -ml-1"
            aria-label="Back to list"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <polyline points="15,18 9,12 15,6"></polyline>
            </svg>
          </Button>
        ) : (
          <span aria-hidden="true" className="w-6" />
        )}
        <div className="flex-1 text-center text-sm font-semibold theme-text-primary truncate px-2">
          Task Details
        </div>
        <TaskActionMenu
          task={task}
          currentUser={currentUser}
          reminderDebugMode={reminderDebugMode}
          onCopy={onCopy}
          onShare={onShare}
          onDelete={onDelete}
          onTestReminder={onTestReminder}
        />
      </div>

      {/* Task Content Row: checkbox + title editor */}
      <div className="p-4">
        <div className="flex items-center space-x-2 min-w-0">
          <TaskCheckbox
            checked={tempCompleted}
            onToggle={onToggleComplete}
            priority={task.priority}
            repeating={task.repeating !== 'never'}
          />
          {editingTitle ? (
            <textarea
              value={tempTitle}
              onChange={(e) => {
                setTempTitle(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSaveTitle() }
                if (e.key === "Escape") onCancelTitle()
              }}
              onBlur={onSaveTitle}
              ref={(el) => {
                if (el) {
                  el.focus()
                  el.style.height = 'auto'
                  el.style.height = el.scrollHeight + 'px'
                }
              }}
              className="text-lg px-2 py-1 rounded flex-1 bg-transparent border-none outline-none resize-none overflow-hidden theme-text-primary"
              rows={1}
            />
          ) : (
            <span
              className={`text-lg cursor-pointer hover:theme-bg-hover px-2 py-1 rounded flex-1 min-w-0 break-words [overflow-wrap:anywhere] ${
                task.completed ? "line-through theme-text-muted" : "theme-text-primary"
              }`}
              onClick={() => setEditingTitle(true)}
            >
              {task.title}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
