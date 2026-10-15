"use client"

/**
 * The occurrence chain in task details (AWTD-1219, spec §10.2).
 *
 * On a GitHub-backed board a repeating task does not roll forward in place.
 * Completing it leaves the row completed and the server creates a NEW task for
 * the next occurrence, linked back by `previousOccurrenceId`. So a single
 * occurrence is one link in a chain, and without this row there is no way to
 * reach the rest of it — the series looks like a pile of unrelated tasks.
 *
 * Its own component for the reason `TaskDetailIdentifierRow` is: it keeps
 * `TaskFieldEditors` from growing (tests/rules/oversized-files-ratchet.test.ts).
 *
 * **Renders nothing outside spawn mode, which is almost everywhere.** A classic
 * list rolls the same row forward, so neither id is ever set and this row is
 * absent — not empty. Clients that have never heard of these fields behave
 * exactly as before, which is what let the server half ship on its own.
 *
 * **`nextOccurrenceId` rides the DETAIL payload only.** A task read from a list
 * response does not carry it, so its absence means "not known here", never
 * "there is no successor". That is why the two links are independent: showing
 * one does not imply anything about the other.
 */

import { ArrowLeft, ArrowRight, Repeat } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { useTranslations } from "@/lib/i18n/client"
import type { Task } from "@/types/task"

interface TaskDetailOccurrenceRowProps {
  task: Task
}

/** The same task link a `!task` reference renders (lib/markdown.ts). */
function OccurrenceLink({ id, label, icon }: { id: string; label: string; icon: React.ReactNode }) {
  return (
    <a
      href={`/?task=${encodeURIComponent(id)}`}
      className="inline-flex items-center gap-1 text-sm theme-text-muted hover:theme-text-secondary hover:underline"
    >
      {icon}
      {label}
    </a>
  )
}

export function TaskDetailOccurrenceRow({ task }: TaskDetailOccurrenceRowProps) {
  const { t } = useTranslations()

  const previousId = task.previousOccurrenceId
  const nextId = task.nextOccurrenceId
  if (!previousId && !nextId) return null

  return (
    <TaskFieldRow label={t("tasks.occurrence.label")} icon={<Repeat className="w-4 h-4" />}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {previousId && (
          <OccurrenceLink
            id={previousId}
            label={t("tasks.occurrence.previous")}
            icon={<ArrowLeft className="w-3.5 h-3.5" aria-hidden />}
          />
        )}
        {nextId && (
          <OccurrenceLink
            id={nextId}
            label={t("tasks.occurrence.next")}
            icon={<ArrowRight className="w-3.5 h-3.5" aria-hidden />}
          />
        )}
      </div>
    </TaskFieldRow>
  )
}
