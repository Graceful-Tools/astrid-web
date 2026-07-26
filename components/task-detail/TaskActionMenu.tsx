import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Copy, Share2, Trash2, Bug, MoreVertical } from "lucide-react"
import type { Task, User } from "../../types/task"
import { canUserManageList } from "@/lib/list-permissions"

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
}

export function TaskActionMenu({
  task,
  currentUser,
  reminderDebugMode,
  onCopy,
  onShare,
  onDelete,
  onTestReminder,
}: TaskActionMenuProps) {
  const taskList = task.lists?.[0]
  const isPublicListTask = taskList?.privacy === 'PUBLIC'
  const isUserOwnerOrAdmin = canUserManageList(currentUser, taskList as never)
  const showDelete = !(isPublicListTask && !isUserOwnerOrAdmin)

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
