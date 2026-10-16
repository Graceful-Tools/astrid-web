"use client"

import { PriorityPicker } from "@/components/ui/priority-picker"
import { PRIORITY_ROW_GLYPH } from "@/lib/priority-glyph"
import { TaskFieldRow } from "./TaskFieldRow"
import { useTranslations } from "@/lib/i18n/client"

/**
 * The Priority row of the task detail pane.
 *
 * Extracted from TaskFieldEditors.tsx (AWTD-1210), which is the direction that
 * file has been going since AWTD-1002 — `components/task-detail/` holds the
 * rows and TaskFieldEditors composes them. The oversized-files ratchet asks for
 * the next piece to come out rather than for its number to be raised, and this
 * row is self-contained: one picker, one icon, and the two visibility rules
 * below.
 *
 * The row decides nothing about WHERE it sits; it is third, after Date, and
 * TaskFieldEditors still places it.
 */

/**
 * The Priority row's marker: the app's own `!!!`, not a flag icon that only ever
 * said "some field about importance" (task 4dd640d9).
 *
 * CONSTANT BY DESIGN — it names the field while the picker beside it reports the
 * value, so it must not follow the task's own priority. Same rule as
 * `PriorityGlyph.rowIcon` on iOS/Mac.
 */
function PriorityRowIcon() {
  return (
    <span aria-hidden="true" className="w-4 text-center text-xs font-bold leading-none">
      {PRIORITY_ROW_GLYPH}
    </span>
  )
}

export interface TaskDetailPriorityRowProps {
  /** `number`, not the 0-3 union: that is what PriorityPicker takes, and the
   *  pane's own temp state is a plain number. */
  value: number
  onChange: (priority: number) => void
  readOnly?: boolean
  /** A public-list task has no priority picker; its Who slot showed "Created by". */
  hidden?: boolean
}

export function TaskDetailPriorityRow({ value, onChange, readOnly = false, hidden = false }: TaskDetailPriorityRowProps) {
  const { t } = useTranslations()
  if (hidden) return null

  return (
    <TaskFieldRow label={t("tasks.priority")} icon={<PriorityRowIcon />}>
      <PriorityPicker
        value={value}
        onChange={onChange}
        /* No `label` passed: PriorityPicker declares the prop but never
           renders it, and the row above already carries the translated
           label. Passing an English literal to a prop nobody displays is
           dead weight that reads as untranslated copy. */
        // Every other field here gates its click behind !readOnly; this
        // one rendered ungated, so priority stayed editable to a viewer
        // who could edit nothing else. (Task 72cb4a13.)
        disabled={readOnly}
      />
    </TaskFieldRow>
  )
}
