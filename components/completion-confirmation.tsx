"use client"

import React from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n/client"

/**
 * "Complete this task?" — asked before finishing work assigned to somebody else
 * (task 43bcc76c, generalised by AWTD-877).
 *
 * It began behind the avatar in task details, the one surface where the leading
 * control was the only completion affordance. AWTD-877 moved the tap itself to
 * the options sheet on every surface, so this moved with it: the sheet's
 * Complete button asks, and the row, details and board card now share one
 * answer instead of three. `completionNeedsConfirmation` decides when.
 *
 * Portalled to the body for the same reason the options sheet is
 * (components/priority-assignee-picker.tsx): it is rendered from inside panels
 * that scroll and clip, and a confirmation that can be cut off by its own
 * container is worse than none.
 *
 * It names the assignee. A dialog asking whether to complete "this task" over
 * an unlabelled photo is exactly the blind confirmation that trains people to
 * accept without reading.
 */
export function CompletionConfirmation({
  assigneeLabel,
  onCancel,
  onConfirm,
}: {
  assigneeLabel: string
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
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
        className="relative w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-800"
      >
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('tasks.confirmCompleteTitle')}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('tasks.confirmCompleteAssigned', { name: assigneeLabel })}
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
