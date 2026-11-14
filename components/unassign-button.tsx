"use client"

import { X } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import { hasAnyAssignee, withoutAssignees } from "@/lib/task-assignees"

type Assignable = { assigneeId?: string | null; assigneeIds?: readonly string[] | null }

/**
 * One-tap × beside the assignee picker (AWTD-1637, iOS/Mac AITD-650).
 *
 * Renders nothing unless the task holds someone — primary or not — so the
 * control never offers to clear an empty field. Hands the caller the task with
 * every assignee cleared (`withoutAssignees`), so a multi-assignee board is
 * emptied rather than having its next person promoted.
 */
export function UnassignButton<T extends Assignable>({
  task,
  onUnassign,
  disabled,
}: {
  task: T
  onUnassign: (cleared: ReturnType<typeof withoutAssignees<T>>) => void
  disabled?: boolean
}) {
  const { t } = useTranslations()
  if (disabled || !hasAnyAssignee(task)) return null
  const label = t('assignee.clear')
  return (
    <button
      type="button"
      data-testid="unassign-button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        // It sits inside rows that open the picker on a tap; the × must not
        // also open what it sits beside.
        event.stopPropagation()
        onUnassign(withoutAssignees(task))
      }}
      className="inline-flex min-w-hit-target min-h-hit-target items-center justify-center rounded-full text-theme-muted theme-surface-hover transition-colors"
    >
      <X className="w-4 h-4" aria-hidden="true" />
    </button>
  )
}
