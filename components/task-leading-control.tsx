"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TaskCheckbox } from "@/components/task-checkbox"
import { useTranslations } from "@/lib/i18n/client"
import {
  getPriorityColor,
  taskLeadingControlKind,
} from "@/lib/task-leading-control"

/**
 * The leading control on a task — one component for all three answers to
 * "whose task is this?" (task 2bb1b196, companion to iOS/Mac 42013da7).
 *
 * The task row, task details, view-only details and quick add all render this
 * rather than each deciding for itself, which is how unassigned came to look
 * identical to "mine" in some places and not others. The rule itself lives in
 * `lib/task-leading-control.ts`.
 *
 * Tapping any of the three marks completes the task. The mark changes, the
 * action does not.
 */
interface TaskLeadingControlProps {
  assigneeId?: string | null
  currentUserId?: string | null
  completed: boolean
  priority: number
  repeating?: boolean
  /** Only read for the 'avatar' kind. */
  assignee?: { name?: string | null; email?: string | null; image?: string | null } | null
  onToggleComplete: () => void
}

/** Priority-coloured square shared by the avatar and unassigned marks. */
const SQUARE_CLASS = "w-8 h-8 rounded-lg border-2 flex items-center justify-center"

export function TaskLeadingControl({
  assigneeId,
  currentUserId,
  completed,
  priority,
  repeating = false,
  assignee,
  onToggleComplete,
}: TaskLeadingControlProps) {
  const { t } = useTranslations()
  const kind = taskLeadingControlKind({ assigneeId, currentUserId, completed })
  const borderColor = getPriorityColor(priority)

  if (kind === 'checkbox') {
    return (
      <TaskCheckbox
        checked={completed}
        onToggle={onToggleComplete}
        priority={priority as 0 | 1 | 2 | 3}
        repeating={repeating}
      />
    )
  }

  if (kind === 'avatar') {
    // Someone else's task: their photo, not a checkbox you could mistake for
    // your own. Deliberately not clickable — completing another person's task
    // from the row was never an affordance here.
    return (
      <div className="relative p-2 -m-2 flex items-center justify-center self-center">
        <Avatar className={SQUARE_CLASS} style={{ borderColor }}>
          <AvatarImage src={assignee?.image || undefined} />
          <AvatarFallback className="text-xs bg-gray-300 text-gray-700 rounded-lg">
            {assignee?.name?.slice(0, 2) || assignee?.email?.slice(0, 2) || '?'}
          </AvatarFallback>
        </Avatar>
      </div>
    )
  }

  return (
    <div
      className="relative p-2 -m-2 cursor-pointer flex items-center justify-center self-center"
      role="button"
      tabIndex={0}
      aria-label={t('tasks.unassigned')}
      onClick={(e) => {
        e.stopPropagation()
        onToggleComplete()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onToggleComplete()
        }
      }}
    >
      <div className={SQUARE_CLASS} style={{ borderColor }}>
        <span className="text-sm font-medium" style={{ color: borderColor }}>
          {t('tasks.unassignedMark')}
        </span>
      </div>
    </div>
  )
}
