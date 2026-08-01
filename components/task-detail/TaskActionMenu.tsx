import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Copy, Share2, Trash2, Bug, MoreVertical, Ban, RotateCcw } from "lucide-react"
import type { Task, User } from "../../types/task"
import { canUserManageList } from "@/lib/list-permissions"
import { isCanceled } from "@/lib/closed-reason"
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
}: TaskActionMenuProps) {
  const { t } = useTranslations()
  const taskList = task.lists?.[0]
  const isPublicListTask = taskList?.privacy === 'PUBLIC'
  const isUserOwnerOrAdmin = canUserManageList(currentUser, taskList as never)
  const showDelete = !(isPublicListTask && !isUserOwnerOrAdmin)
  // "Won't do" sits next to Delete, in a menu users already open to delete —
  // no new control on the row, nothing new for a consumer user to learn.
  const canceled = isCanceled(task)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="flex-shrink-0 theme-text-muted hover:theme-text-secondary">
          <MoreVertical className="w-5 h-5" />
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
