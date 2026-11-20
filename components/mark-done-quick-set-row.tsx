"use client"

/**
 * The "Mark as done" row of the quick changer (ADEV-158), the web twin of iOS's
 * `MarkDoneQuickSetRow` (ADEV-146/148/152).
 *
 * Your own task: one row on the `bg-secondary` surface with the task row's own
 * checkbox (unchecked beside "Mark as done", checked beside "Mark as to-do",
 * in the task's priority colour).
 *
 * Someone else's, or nobody's: the sheet is still the confirmation (AWTD-877,
 * ADEV-71), so it shows one muted line saying whose it is, with Cancel and
 * Complete. There is no title above it any more.
 */
import { CheckboxArt } from "@/components/task-checkbox-art"
import { useTranslations } from "@/lib/i18n/client"

interface MarkDoneQuickSetRowProps {
  priority: number
  completed: boolean
  repeating?: boolean
  /** Someone else's or nobody's task: complete asks first. */
  asksBeforeCompleting: boolean
  /** Muted line for the confirmation; already translated. */
  holderLine?: string
  onToggleComplete: () => void
  onCancel: () => void
}

export function MarkDoneQuickSetRow({
  priority,
  completed,
  repeating,
  asksBeforeCompleting,
  holderLine,
  onToggleComplete,
  onCancel,
}: MarkDoneQuickSetRowProps) {
  const { t } = useTranslations()

  if (asksBeforeCompleting) {
    return (
      <div data-testid="task-options-complete-row">
        {holderLine && (
          <p className="mb-3 text-xs text-theme-muted" data-testid="task-options-complete-holder">
            {holderLine}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="task-options-complete-cancel"
            onClick={onCancel}
            className="flex-1 h-11 rounded-lg text-sm font-medium text-theme-secondary transition-all duration-fast active:scale-95"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-testid="task-options-complete"
            onClick={onToggleComplete}
            className="flex-1 h-11 rounded-lg text-sm font-medium border-2 border-theme-button text-theme-secondary transition-all duration-fast active:scale-95"
          >
            {t("common.complete")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      data-testid="task-options-complete"
      onClick={onToggleComplete}
      className="w-full h-11 rounded-lg bg-secondary px-3 flex items-center gap-3 text-left text-sm font-medium text-theme-primary transition-all duration-fast active:scale-95"
    >
      <span data-testid="task-options-complete-icon" className="w-leading-control h-leading-control shrink-0 inline-flex">
        <CheckboxArt
          priority={priority}
          checked={completed}
          repeating={repeating}
          className="w-leading-control h-leading-control"
        />
      </span>
      {completed ? t("tasks.markAsTodo") : t("tasks.markAsDone")}
    </button>
  )
}
