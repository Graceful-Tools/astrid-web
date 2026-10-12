"use client"

/**
 * The subtasks section in task details (AWTD-1227).
 *
 * iPhone, iPad and Mac have shown "Sub tasks 0/2" with its child rows for a
 * long time; web's detail pane showed nothing at all, though web nests the same
 * children in the LIST. So the data and the concept were both already here —
 * only this pane was missing them. Jon picked the Mac pattern for task detail
 * in [AWTD-1177](https://astrid.cc/t/AWTD-1177), and this is the substantive
 * part of that.
 *
 * **Not a `TaskFieldRow`.** The field rows are one value each, in the icon
 * column that lines up with the title checkbox. This is a section with a
 * heading and a list, like comments below it — which is also how Mac draws it.
 *
 * **Completing a child goes through the SAME path as a list row.** The handler
 * passed in is `handleToggleTaskComplete`, the one `TaskRow` calls. A second
 * completion path here would be a second place for repeating tasks, streaks,
 * board columns and offline queuing to be got wrong — and the repo already has
 * a rule test about completion going through one service for that reason.
 */

import { useState } from "react"
import { Plus } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslations } from "@/lib/i18n/client"
import type { Task } from "@/types/task"

interface TaskDetailSubtasksSectionProps {
  /** The children of this task. Empty renders the add row only. */
  subtasks: Task[]
  /** Completing a child — the list row's handler, not a second one. */
  onToggleComplete?: (taskId: string) => void | Promise<void>
  /** Creating a child. Absent means the add row is not offered. */
  onAdd?: (title: string) => void | Promise<void>
  readOnly?: boolean
}

export function TaskDetailSubtasksSection({
  subtasks,
  onToggleComplete,
  onAdd,
  readOnly = false,
}: TaskDetailSubtasksSectionProps) {
  const { t } = useTranslations()
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)

  const canAdd = !readOnly && Boolean(onAdd)

  // Nothing to show and nothing to do: render nothing rather than an empty
  // heading on the overwhelming majority of tasks, which have no children.
  if (subtasks.length === 0 && !canAdd) return null

  const done = subtasks.filter(subtask => subtask.completed).length

  const submit = async () => {
    const trimmed = title.trim()
    if (!trimmed || saving || !onAdd) return
    setSaving(true)
    try {
      await onAdd(trimmed)
      // Cleared only on success, so a failed add does not lose what was typed.
      setTitle("")
    } catch {
      // Swallowed on purpose, and the text is kept. The create path already
      // reports its own failures; what must not happen here is the rejection
      // escaping an event handler as an unhandled promise, or the field
      // clearing as though the subtask had been created.
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2" aria-label={t("tasks.subtasks")}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium theme-text-primary">{t("tasks.subtasks")}</h3>
        {subtasks.length > 0 && (
          <span className="text-xs theme-text-muted tabular-nums">
            {t("tasks.subtaskSection.count", { done: String(done), total: String(subtasks.length) })}
          </span>
        )}
      </div>

      <ul className="space-y-1">
        {subtasks.map(subtask => (
          <li key={subtask.id} className="flex items-center gap-2">
            <Checkbox
              checked={subtask.completed}
              disabled={readOnly || !onToggleComplete}
              onCheckedChange={() => onToggleComplete?.(subtask.id)}
              aria-label={subtask.title}
            />
            {/* The same task link a `!task` reference renders (lib/markdown.ts),
                so a subtask can be opened without hunting for it in the list. */}
            <a
              href={`/?task=${encodeURIComponent(subtask.id)}`}
              className={`text-sm hover:underline ${
                subtask.completed ? "line-through theme-text-muted" : "theme-text-primary"
              }`}
            >
              {subtask.title}
            </a>
          </li>
        ))}
      </ul>

      {canAdd && (
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 theme-text-muted flex-shrink-0" aria-hidden />
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault()
                void submit()
              }
            }}
            onBlur={() => void submit()}
            disabled={saving}
            placeholder={t("tasks.subtaskSection.addPlaceholder")}
            aria-label={t("tasks.subtaskSection.add")}
            className="flex-1 bg-transparent border-none outline-none text-sm theme-text-primary placeholder:theme-text-muted"
          />
        </div>
      )}
    </section>
  )
}
