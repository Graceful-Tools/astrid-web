import { useTranslations } from "@/lib/i18n/client"
import { Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TaskLeadingControl } from "../task-leading-control"
import { PublicTaskCopyButton } from "../public-task-copy-button"
import { isPublicListTask } from "@/lib/public-list-utils"
import { TaskActionMenu } from "./TaskActionMenu"
import { FIELD_ROW_GAP_CLASS } from "./TaskFieldRow"
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
  /** Open the options popover when the leading control's tap does (someone
   *  else's or an unassigned task — lib/task-leading-control.ts). */
  onOpenOptions?: () => void
  onClose?: () => void
  // Title editing state from useTaskDetailState (parent owns it)
  tempCompleted: boolean
  tempTitle: string
  editingTitle: boolean
  setTempTitle: (s: string) => void
  setEditingTitle: (b: boolean) => void
  onToggleComplete: () => void
  /**
   * View-only: the viewer cannot edit this task. Only affects the leading
   * control here — on a PUBLIC list task the one action a viewer has is to
   * copy it to their own list, which is what task-detail-viewonly offers in
   * place of the completion control. (Task 72cb4a13.)
   */
  readOnly?: boolean
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
  /** Move the task to a board column, by column id (task ba1a4c4c). */
  onStatusSelect?: (columnId: string) => void
  /** Passed through to TaskActionMenu (AWTD-1252). */
  hideCopyIdentifier?: boolean
  /** Full-screen task details (task dcbbb0fa). Undefined where the pane is
   *  already full screen (the phone). */
  fullScreen?: boolean
  onToggleFullScreen?: () => void
}

export function TaskHeader({
  task,
  onOpenOptions,
  currentUser,
  onClose,
  tempCompleted,
  tempTitle,
  editingTitle,
  setTempTitle,
  setEditingTitle,
  onToggleComplete,
  readOnly = false,
  onSaveTitle,
  onCancelTitle,
  reminderDebugMode,
  onCopy,
  onShare,
  onDelete,
  onTestReminder,
  onCancel,
  onStatusSelect,
  hideCopyIdentifier,
  fullScreen,
  onToggleFullScreen,
}: TaskHeaderProps) {
  const { t } = useTranslations()
  return (
    <div className="border-b border-theme-surface">
      {/* Task Content Row: back (mobile) + checkbox + title editor + action menu.
       *
       *  There is no separate "Task Details" header bar (task cc76307c). It cost a
       *  full 44px row to say something the user already knew — they just opened a
       *  task — and pushed the description further below the fold, which is the
       *  same space argument driving the wider edit-page redesign.
       *
       *  The action menu now sits inline at the far right of the title row in every
       *  layout, so 2-column, 3-column and a board callout agree. The mobile
       *  back button moved here rather than being deleted with the bar: it was the
       *  only way back to the list on a narrow viewport. */}
      <div className="p-4">
        <div className={`flex items-center min-w-0 ${FIELD_ROW_GAP_CLASS}`}>
          {onClose && (
            <Button
              variant="ghost"
              onClick={onClose}
              className="cols2:hidden flex items-center shrink-0 theme-text-primary hover:theme-text-secondary rounded-md hover:theme-bg-hover px-1 py-1 -ml-1"
              aria-label={t('tasks.detail.backToList')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polyline points="15,18 9,12 15,6"></polyline>
              </svg>
            </Button>
          )}
          {readOnly && isPublicListTask(task) ? (
            /* A viewer of a public task cannot complete it, so completion is
               replaced by copy-to-my-list — matching task-detail-viewonly and
               task-row-content, which already make this substitution. Gated on
               readOnly as well as public so a user who CAN edit a public task
               keeps the completion control they have today. */
            <PublicTaskCopyButton onCopy={onCopy} />
          ) : (
          /* Three states, not two — an unassigned task must not look like one
              you own (task 2bb1b196). Same rule as the row and quick add. */
          <TaskLeadingControl
            assigneeId={task.assigneeId}
            currentUserId={currentUser?.id}
            assignee={task.assignee}
            completed={tempCompleted}
            priority={task.priority}
            repeating={task.repeating !== 'never'}
            onToggleComplete={onToggleComplete}
            onOpenOptions={onOpenOptions}
          />
          )}
          {editingTitle ? (
            <textarea
              data-testid="task-detail-title-input"
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
              className="text-base py-1 px-2 rounded flex-1 bg-transparent border-none outline-hidden resize-none overflow-hidden theme-text-primary"
              rows={1}
            />
          ) : (
            <span
              className={`text-base ${readOnly ? '' : 'cursor-pointer hover:theme-bg-hover'} py-1 rounded flex-1 min-w-0 wrap-break-word wrap-anywhere px-2 ${
                task.completed ? "line-through theme-text-muted" : "theme-text-primary"
              }`}
              data-testid="task-detail-title"
              // A read-only seat (a viewer of a public list) sees the title
              // but cannot open it for editing (AWTD-1405).
              onClick={readOnly ? undefined : () => setEditingTitle(true)}
            >
              {task.title}
            </span>
          )}
          {/* Action menu, far right of the title row in every layout. */}
          <div className="flex items-center shrink-0">
            {onToggleFullScreen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleFullScreen}
                // Deliberately NOT gated on a viewport breakpoint. Whether a
                // pane can be expanded is decided by whoever renders it —
                // the phone pane simply passes no handler, because it is
                // already full screen. Keying this off `cols2` (910px)
                // instead hid the control on iPad portrait, where the
                // windowed pane does render. (Task 0ea0b818)
                className="theme-text-muted hover:theme-text-primary h-7 w-7 p-0 inline-flex"
                aria-label={t(fullScreen ? 'tasks.detail.exitFullScreen' : 'tasks.tradeoffGrid.fullScreen')}
                title={t(fullScreen ? 'tasks.detail.exitFullScreen' : 'tasks.tradeoffGrid.fullScreen')}
              >
                {fullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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
              onStatusSelect={onStatusSelect}
              hideCopyIdentifier={hideCopyIdentifier}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
