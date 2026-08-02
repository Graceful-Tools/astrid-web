import { ChevronUp } from "lucide-react"
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
  /** Close as "won't do" / reopen (task 11042ae3). */
  onCancel?: (closedReason: string | null) => void
  /** Compact: drop the centered "Task Details" header bar and put the action
   *  menu inline next to the title (used by inline panels like the board card).
   */
  compact?: boolean
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
  onCancel,
  compact = false,
}: TaskHeaderProps) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Task Content Row: back (mobile) + checkbox + title editor + action menu.
       *
       *  There is no separate "Task Details" header bar (task cc76307c). It cost a
       *  full 44px row to say something the user already knew — they just opened a
       *  task — and pushed the description further below the fold, which is the
       *  same space argument driving the wider edit-page redesign.
       *
       *  The action menu now sits inline at the far right of the title row in every
       *  layout, so 2-column, 3-column and the inline/board panel agree. The mobile
       *  back button moved here rather than being deleted with the bar: it was the
       *  only way back to the list on a narrow viewport. */}
      <div className="p-4">
        <div className="flex items-center space-x-2 min-w-0">
          {!compact && onClose && (
            <Button
              variant="ghost"
              onClick={onClose}
              className="cols2:hidden flex items-center flex-shrink-0 theme-text-primary hover:theme-text-secondary rounded-md hover:theme-bg-hover px-1 py-1 -ml-1"
              aria-label="Back to list"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <polyline points="15,18 9,12 15,6"></polyline>
              </svg>
            </Button>
          )}
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
              className={`text-base px-2 py-1 rounded flex-1 bg-transparent border-none outline-none resize-none overflow-hidden theme-text-primary ${
                compact ? 'font-medium leading-tight' : ''
              }`}
              rows={1}
            />
          ) : (
            <span
              className={`text-base cursor-pointer hover:theme-bg-hover px-2 py-1 rounded flex-1 min-w-0 break-words [overflow-wrap:anywhere] ${
                compact ? 'font-medium leading-tight' : ''
              } ${
                task.completed ? "line-through theme-text-muted" : "theme-text-primary"
              }`}
              onClick={() => setEditingTitle(true)}
            >
              {task.title}
            </span>
          )}
          {/* Action menu, far right of the title row in every layout. Compact
           *  stacks a collapse chevron above it (an inline panel collapses rather
           *  than navigating back). */}
          {compact ? (
            <div className="flex flex-col items-center -my-1 flex-shrink-0">
              {onClose && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="theme-text-muted hover:theme-text-primary h-6 w-6 p-0"
                  aria-label="Collapse task"
                  title="Collapse"
                >
                  <ChevronUp className="w-4 h-4" />
                </Button>
              )}
              <TaskActionMenu
                task={task}
                currentUser={currentUser}
                reminderDebugMode={reminderDebugMode}
                onCopy={onCopy}
                onShare={onShare}
                onDelete={onDelete}
                onTestReminder={onTestReminder}
                onCancel={onCancel}
              />
            </div>
          ) : (
            <div className="flex-shrink-0">
              <TaskActionMenu
                task={task}
                currentUser={currentUser}
                reminderDebugMode={reminderDebugMode}
                onCopy={onCopy}
                onShare={onShare}
                onDelete={onDelete}
                onTestReminder={onTestReminder}
                onCancel={onCancel}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
