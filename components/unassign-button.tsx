"use client"

import { X } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import { hasAnyAssignee } from "@/lib/task-assignees"

/**
 * One-tap × beside the assignee picker (AWTD-1637, iOS/Mac AITD-650).
 *
 * Renders nothing unless the task holds someone — primary or not — so the
 * control never offers to clear an empty field. The caller decides what
 * "unassign" writes; pass `withoutAssignees(task)` from lib/task-assignees so a
 * multi-assignee board is emptied rather than having its next person promoted.
 */
export function UnassignButton({
  assigneeId,
  assigneeIds,
  onUnassign,
  disabled,
}: {
  assigneeId?: string | null
  assigneeIds?: readonly string[] | null
  onUnassign: () => void
  disabled?: boolean
}) {
  const { t } = useTranslations()
  if (disabled || !hasAnyAssignee({ assigneeId, assigneeIds })) return null
  const label = t('assignee.clear')
  return (
    <button
      type="button"
      data-testid="unassign-button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        // Inside a clickable row (task details opens the picker on a tap), the
        // × must not also open what it sits beside.
        event.stopPropagation()
        onUnassign()
      }}
      className="inline-flex min-w-hit-target min-h-hit-target items-center justify-center rounded-full text-theme-muted theme-surface-hover transition-colors"
    >
      <X className="w-4 h-4" aria-hidden="true" />
    </button>
  )
}
