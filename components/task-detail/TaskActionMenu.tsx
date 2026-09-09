import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Copy, Share2, Trash2, Bug, MoreVertical, Ban, RotateCcw, Columns3 } from "lucide-react"
import type { Task, User } from "../../types/task"
import { canUserManageList } from "@/lib/list-permissions"
import { isCanceled } from "@/lib/closed-reason"
import { boardColumnsFor, taskColumnId } from "@/lib/task-status"
import { useTranslations } from "@/lib/i18n/client"

/**
 * Action dropdown menu (the "..." button on the task detail header).
 *
 * Extracted from task-detail.tsx as the first step of the god-component split.
 * Behavior is unchanged — same trigger, same items, same conditional logic for
 * the Delete item on PUBLIC lists and the Test Reminder item in debug mode.
 */
interface TaskActionMenuProps {
  task: Task
  currentUser: User
  /**
   * Board-card sizing: a 20px trigger with a 16px icon, so the whole action
   * column fits inside the card's ordinary right gutter.
   *
   * The default `size="sm"` trigger is wider than that, and it is the widest
   * thing in the column — so it, not the two buttons beside it, is what
   * decided how much width expanding a card stole from the title
   * (task 8eee392d).
   */
  compact?: boolean
  reminderDebugMode: boolean
  onCopy: () => void
  onShare: () => void
  onDelete: () => void
  onTestReminder: () => void
  /**
   * Close the task as "won't do" — or reopen it if it already is
   * (task 11042ae3). Optional so call sites that predate it still compile.
   */
  onCancel?: (closedReason: string | null) => void
  /**
   * Move the task to a board column, by column id (task ba1a4c4c).
   *
   * The status picker used to render only in project display mode or on a
   * board, so on an ordinary list there was NO way to reach "Ready" — and a
   * task is in an agent's queue only when it is both assigned to that agent
   * and ready. The whole agent workflow had one entry point, and it was not
   * the one the setup instructions send you to.
   *
   * This menu is rendered by every display mode, which is why the control
   * lives here rather than in a fifth field row: the rows under the title are
   * a cross-platform contract (Who, Date, Priority, Lists — see
   * lib/task-detail-field-order.ts) that this must not renegotiate.
   *
   * Optional, so call sites that predate it compile and render unchanged. The
   * caller maps the column id through resolveColumnMove, which is what knows
   * that Done means completed rather than a status role.
   */
  onStatusSelect?: (columnId: string) => void
}

export function TaskActionMenu({
  task,
  currentUser,
  reminderDebugMode,
  onCopy,
  onShare,
  onDelete,
  onTestReminder,
  onCancel,
  onStatusSelect,
  compact = false,
}: TaskActionMenuProps) {
  const { t } = useTranslations()
  const taskList = task.lists?.[0]
  const isPublicListTask = taskList?.privacy === 'PUBLIC'
  const isUserOwnerOrAdmin = canUserManageList(currentUser, taskList as never)
  const showDelete = !(isPublicListTask && !isUserOwnerOrAdmin)
  // "Won't do" sits next to Delete, in a menu users already open to delete —
  // no new control on the row, nothing new for a consumer user to learn.
  const canceled = isCanceled(task)
  // boardColumnsFor(null) is the same list the board renders and does not
  // depend on the list being agent-configured — Ready has always existed here,
  // it just had nowhere to be chosen from.
  const statusColumns = onStatusSelect ? boardColumnsFor(null) : []
  const currentColumnId = taskColumnId(task)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`flex-shrink-0 theme-text-muted hover:theme-text-secondary ${
            compact ? "h-5 w-5 p-0" : ""
          }`}
        >
          <MoreVertical className={compact ? "w-4 h-4" : "w-5 h-5"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onCopy}>
          <Copy className="w-4 h-4 mr-2" />
          Copy
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onShare}>
          <Share2 className="w-4 h-4 mr-2" />
          Share
        </DropdownMenuItem>
        {onStatusSelect && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Columns3 className="w-4 h-4 mr-2" />
                {t("tasks.status")}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={currentColumnId} onValueChange={onStatusSelect}>
                    {statusColumns.map(column => (
                      <DropdownMenuRadioItem key={column.id} value={column.id}>
                        {column.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </>
        )}
        {onCancel && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onCancel(canceled ? null : 'canceled')}>
              {canceled ? (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {t("tasks.reopen")}
                </>
              ) : (
                <>
                  <Ban className="w-4 h-4 mr-2" />
                  {t("tasks.wontDo")}
                </>
              )}
            </DropdownMenuItem>
          </>
        )}
        {showDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-600">
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </>
        )}
        {reminderDebugMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onTestReminder} className="text-orange-500 focus:text-orange-500">
              <Bug className="w-4 h-4 mr-2" />
              Test Reminder
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
