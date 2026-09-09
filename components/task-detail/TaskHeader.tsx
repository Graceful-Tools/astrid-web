import { ChevronUp, Maximize2, Minimize2 } from "lucide-react"
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
  /** Viewer's task display mode; absent means list (task ffa5bbb5). */
  displayMode?: string | null
  /** Project mode: open the options popover instead of completing. */
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
  /** Full-screen task details (task dcbbb0fa). Undefined for the inline/board
   *  panel, which is deliberately a peek and never offers it. */
  fullScreen?: boolean
  onToggleFullScreen?: () => void
  /** Compact: drop the centered "Task Details" header bar and put the action
   *  menu inline next to the title (used by inline panels like the board card).
   */
  compact?: boolean
}

export function TaskHeader({
  task,
  displayMode,
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
  fullScreen,
  onToggleFullScreen,
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
      {/* Compact (board card) trims the RIGHT padding to almost nothing so the
       *  action column below can sit inside the card's ordinary right gutter
       *  rather than adding a column of its own. Expanding a card used to
       *  narrow the title and rewrap every line — the card visibly jumped
       *  (task 8eee392d). Jon's spec: a ~20px gutter, ~16px buttons, about 2px
       *  either side of them. */}
      <div className={compact ? "p-3 pr-0.5" : "p-4"}>
        <div
          className={`flex items-center min-w-0 ${compact ? "gap-3" : FIELD_ROW_GAP_CLASS}`}
        >
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
            displayMode={displayMode}
            onOpenOptions={onOpenOptions}
            /* Details is the only surface where completion has nowhere else to
               live, so someone else's avatar asks to complete here rather than
               sitting inert as it does on a row (task 43bcc76c). */
            surface="detail"
          />
          )}
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
              className={`text-base py-1 rounded flex-1 bg-transparent border-none outline-none resize-none overflow-hidden theme-text-primary ${
                compact ? 'font-medium leading-tight px-0' : 'px-2'
              }`}
              rows={1}
            />
          ) : (
            <span
              className={`text-base cursor-pointer hover:theme-bg-hover py-1 rounded flex-1 min-w-0 break-words [overflow-wrap:anywhere] ${
                compact ? 'font-medium leading-tight px-0' : 'px-2'
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
            /* Sized to the gutter, not to a comfortable button: 20px boxes
             *  around the same 16px icons, hard against the card edge. Any
             *  wider and the title reflows on expand, which is the whole
             *  complaint.
             *
             *  -ml-2.5 cancels 10px of the row's 12px gap, leaving the 2px the
             *  spec asks for between the title and the buttons. The gap itself
             *  has to stay 12px, because that is what separates the leading
             *  control from the title on the collapsed row. */
            <div className="flex flex-col items-center -my-1 -ml-2.5 flex-shrink-0">
              {/* Full screen is NOT a button here — it is an item in the menu
               *  below (AWTD-872). This column used to stack three 20px targets
               *  vertically inside a card gutter: full screen, collapse, and the
               *  menu. Two is what a card can carry.
               *
               *  Full screen is the one that moved because the other two cannot:
               *  collapse undoes the tap that expanded the card, and the menu is
               *  where every other secondary action already lives. Task 52bf1efb
               *  added full screen here in the first place — a board card's
               *  details had no way to expand however long the description was —
               *  so it is still reachable, one tap deeper. */}
              {onClose && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="theme-text-muted hover:theme-text-primary h-5 w-5 p-0"
                  aria-label="Collapse task"
                  title="Collapse"
                >
                  <ChevronUp className="w-4 h-4" />
                </Button>
              )}
              <TaskActionMenu
                compact
                task={task}
                currentUser={currentUser}
                reminderDebugMode={reminderDebugMode}
                onCopy={onCopy}
                onShare={onShare}
                onDelete={onDelete}
                onTestReminder={onTestReminder}
                onCancel={onCancel}
                onStatusSelect={onStatusSelect}
                onToggleFullScreen={onToggleFullScreen}
                fullScreen={fullScreen}
              />
            </div>
          ) : (
            <div className="flex items-center flex-shrink-0">
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
                  aria-label={fullScreen ? "Exit full screen" : "Full screen"}
                  title={fullScreen ? "Exit full screen" : "Full screen"}
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
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
