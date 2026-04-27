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
      {/* Mobile/Tablet Back Navigation - Full Width */}
      {onClose && (
        <div className="cols2:hidden app-header theme-header theme-border relative">
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full flex items-center justify-start theme-text-primary hover:theme-text-secondary rounded-none hover:theme-bg-hover"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <polyline points="15,18 9,12 15,6"></polyline>
            </svg>
            <span className="text-lg font-semibold">Back to List</span>
          </Button>
        </div>
      )}

      {/* Task Content Row */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
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
                className={`text-lg cursor-pointer hover:theme-bg-hover px-2 py-1 rounded flex-1 ${
                  task.completed ? "line-through theme-text-muted" : "theme-text-primary"
                }`}
                onClick={() => setEditingTitle(true)}
              >
                {task.title}
              </span>
            )}
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
      </div>
    </div>
  )
}
