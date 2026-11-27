"use client"

import React from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n/client"
import { completionNeedsConfirmation } from "@/lib/task-leading-control"
import { isDoneColumn } from "@/lib/task-status"

/**
 * "Complete this task?" — asked before finishing a task that is not yours
 * (task 43bcc76c, generalised by AWTD-877, widened to unassigned by ADEV-56).
 *
 * It began behind the avatar in task details, the one surface where the leading
 * control was the only completion affordance. AWTD-877 moved the tap itself to
 * the options sheet on every surface, so this moved with it: the sheet's
 * Complete button asks, and the row, details and board card now share one
 * answer instead of three. `completionNeedsConfirmation` decides when, and
 * `useCompletionConfirmation` below is how a surface asks it.
 *
 * Portalled to the body for the same reason the options sheet is
 * (components/priority-assignee-picker.tsx): it is rendered from inside panels
 * that scroll and clip, and a confirmation that can be cut off by its own
 * container is worse than none.
 *
 * It names the assignee. A dialog asking whether to complete "this task" over
 * an unlabelled photo is exactly the blind confirmation that trains people to
 * accept without reading. With nobody assigned (ADEV-56) it says so instead —
 * a null `assigneeLabel` — rather than "Assigned to" followed by nothing.
 */
export function CompletionConfirmation({
  assigneeLabel,
  onCancel,
  onConfirm,
}: {
  /** Who holds the task; null means nobody does. */
  assigneeLabel: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslations()

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      onClick={event => event.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xs rounded-2xl bg-theme-surface p-4 shadow-xl"
      >
        <p className="text-sm font-medium text-theme-primary">
          {t('tasks.confirmCompleteTitle')}
        </p>
        <p className="mt-1 text-xs text-theme-muted">
          {assigneeLabel !== null
            ? t('tasks.confirmCompleteAssigned', { name: assigneeLabel })
            : t('tasks.confirmCompleteUnassigned')}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {t('common.complete')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The assignee fields the dialog can name someone from. */
type AssigneeName = { name?: string | null; email?: string | null } | null | undefined

/** The person to name in the dialog, or null when nobody holds the task. */
export function completionAssigneeLabel(assigneeId: string | null | undefined, assignee: AssigneeName): string | null {
  if (!assigneeId) return null
  // Assigned to someone whose name has not loaded is still assigned: say so
  // with an empty name rather than claim nobody holds it.
  return assignee?.name || assignee?.email || ''
}

/**
 * Ask before completing a task that is not yours (ADEV-56), from any surface.
 *
 * `request(task, complete)` runs `complete` at once when the task is yours or
 * the action is a reopen, and otherwise holds it until the dialog is accepted.
 * Render `dialog` anywhere in the caller's tree — it portals itself.
 *
 * One hook rather than a dialog per surface because every completion surface
 * must give the same answer: the leading control's direct tap, the options
 * sheet's Complete button, and the board cards all route here. A surface that
 * grew its own copy is how a confirmation existed in task details and nowhere
 * else (task 43bcc76c).
 *
 * `requestColumnMove(task, column, move)` is the same question for a board
 * move (ADEV-71): a status picker's Done, a card dragged onto Done. Only a move
 * INTO Done asks; every other column runs at once. The move is held, not
 * applied and undone, so a cancelled drag leaves the card where it was.
 *
 * Decide by `assigneeId`. `assignee` is only the name the dialog shows: a task
 * whose `assignee` has not loaded is still the task of whoever `assigneeId` says.
 */
export function useCompletionConfirmation(currentUserId: string | null | undefined) {
  const [pending, setPending] = React.useState<{ label: string | null; run: () => void } | null>(null)

  const request = React.useCallback(
    (
      task: { assigneeId?: string | null; assignee?: AssigneeName; completed?: boolean },
      complete: () => void,
    ) => {
      if (
        completionNeedsConfirmation({
          assigneeId: task.assigneeId,
          currentUserId,
          completed: task.completed,
        })
      ) {
        setPending({ label: completionAssigneeLabel(task.assigneeId, task.assignee), run: complete })
      } else {
        complete()
      }
    },
    [currentUserId],
  )

  const requestColumnMove = React.useCallback(
    (task: Parameters<typeof request>[0], column: { kind: string } | null | undefined, move: () => void) => {
      if (isDoneColumn(column)) request(task, move)
      else move()
    },
    [request],
  )

  const cancel = React.useCallback(() => setPending(null), [])

  const dialog = pending ? (
    <CompletionConfirmation
      assigneeLabel={pending.label}
      onCancel={cancel}
      onConfirm={() => {
        setPending(null)
        pending.run()
      }}
    />
  ) : null

  return { request, requestColumnMove, dialog }
}
