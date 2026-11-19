"use client"

import React from "react"
import { useTranslations } from "@/lib/i18n/client"
import { completedOnDay, doneCompletionDate, formatCompletedOnLabel } from "@/lib/board-done-column"

/**
 * A Done card's completed date, as a small pill under its title: "✓ on Nov 19"
 * (Jon, 2026-11-19; the same on every client — lib/board-done-column.ts).
 * Nothing renders when the task has no date.
 */
export function BoardCompletedOnPill({ task }: {
  task: { completedAt?: Date | string | null; updatedAt?: Date | string | null }
}) {
  const { t, locale } = useTranslations()
  const date = doneCompletionDate(task)
  if (!date) return null
  const label = formatCompletedOnLabel(date, locale)
  const description = t("tasks.board.completedOn", { date: label })
  return (
    <time
      dateTime={completedOnDay(date)}
      className="mt-1 inline-flex rounded-full theme-bg-hover px-2 py-0.5 text-xs theme-text-secondary"
      data-testid="board-card-completed-on"
      aria-label={description}
      title={description}
    >
      {/* "✓ on Nov 19": the check (a plain U+2713, in the translated text so
          every client reads the same) says this is the completion date. The
          aria-label above keeps screen readers on the words. */}
      {t("tasks.board.completedPill", { date: label })}
    </time>
  )
}
