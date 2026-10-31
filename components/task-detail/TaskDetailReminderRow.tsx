"use client"

import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TaskFieldRow } from "./TaskFieldRow"
import { useTranslations } from "@/lib/i18n/client"

/**
 * The Reminder row of the task detail pane (AWTD-1418).
 *
 * Until now web could not set a task's `reminderTime` at all: a reminder only
 * came from a due date or from a native app. This is a plain local
 * date-time input, so the browser supplies the picker, and clearing it sends
 * `null`.
 */

/** `Date` -> the `YYYY-MM-DDTHH:mm` a datetime-local input shows, in local time. */
export function toDateTimeLocalValue(value: Date | string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A datetime-local value -> the moment it names in local time, or null when empty or unreadable. */
export function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export interface TaskDetailReminderRowProps {
  value: Date | string | null | undefined
  onChange: (reminderTime: Date | null) => void
  readOnly?: boolean
}

export function TaskDetailReminderRow({ value, onChange, readOnly = false }: TaskDetailReminderRowProps) {
  const { t } = useTranslations()
  const local = toDateTimeLocalValue(value)

  return (
    <TaskFieldRow label={t("tasks.reminder")} icon={<Bell className="w-4 h-4" />}>
      <div className="flex items-center gap-2" data-testid="reminder-time">
        <input
          type="datetime-local"
          aria-label={t("tasks.reminder")}
          value={local}
          disabled={readOnly}
          onChange={event => onChange(fromDateTimeLocalValue(event.target.value))}
          className="rounded-md border theme-border bg-transparent px-2 py-1 text-sm"
        />
        {local && !readOnly && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {t("actions.clear")}
          </Button>
        )}
      </div>
    </TaskFieldRow>
  )
}
