"use client"

import { useCallback, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TaskFieldRow } from "./TaskFieldRow"
import { useProjectFields } from "@/hooks/use-project-fields"
import {
  optionChoices,
  orderIterationChoices,
  visibleProjectFields,
  type ProjectFieldSchemaEntry,
} from "@/lib/project-field-display"
import { useTranslations } from "@/lib/i18n/client"
import { apiPut } from "@/lib/api"
import type { Task, TaskList } from "@/types/task"

/**
 * A GitHub board's project fields in task detail (AWTD-1210, P6a-4).
 *
 * Spec §9.4, decision D4: on a GitHub-backed board every project field is
 * shown and editable here. Fields are DEFINED in GitHub — Astrid offers no way
 * to create one — and nothing renders on any other list, so a classic task's
 * pane is byte-identical to before.
 *
 * Which fields render, and how an iteration's choices are ordered, are rules
 * rather than presentation and live in `lib/project-field-display.ts`. This
 * component is the editors and the save path.
 *
 * Rows reuse `TaskFieldRow`, the shared two-column row AWTD-1177 introduced
 * precisely so these rows stop drifting from the native ones.
 */

const GITHUB_PROJECT = "github_project"

/** The board a task is on, if it is on one. A task has at most one. */
export function githubBoardOf(lists: TaskList[] | undefined): TaskList | null {
  return lists?.find(list => list.backend === GITHUB_PROJECT && list.projectId) ?? null
}

interface Props {
  task: Task
  availableLists?: TaskList[]
  onUpdate: (task: Task) => void
  readOnly?: boolean
}

export function TaskProjectFieldsSection({ task, onUpdate, readOnly = false }: Props) {
  const { t } = useTranslations()
  const board = githubBoardOf(task.lists)
  const { fields } = useProjectFields(board?.projectId)
  const visible = useMemo(() => visibleProjectFields(fields), [fields])
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(
    async (field: ProjectFieldSchemaEntry, value: string | number | null) => {
      setSaving(field.id)
      setError(null)
      try {
        // apiPut, not a raw fetch: offline it queues the mutation and replays
        // it, where a raw fetch would drop the edit silently
        // (tests/rules/raw-fetch-mutations-ratchet.test.ts).
        const response = await apiPut(`/api/v1/tasks/${task.id}/fields/${field.id}`, { value })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string; ssoUrl?: string }
          // The GitHub write errors a person can act on get their own words;
          // everything else is one message rather than a raw code.
          setError(
            body.error === "auth_required"
              ? t("tasks.projectFields.errorAuthRequired")
              : body.error === "sso_required"
                ? t("tasks.projectFields.errorSsoRequired")
                : t("tasks.projectFields.errorSaveFailed"),
          )
          return
        }
        // Keep the pane's own copy in step without a refetch; the row is the
        // only thing that changed.
        const next = { ...(task.fields ?? {}) }
        if (value === null) delete next[field.id]
        else next[field.id] = value
        onUpdate({ ...task, fields: next })
      } catch {
        setError(t("tasks.projectFields.errorSaveFailed"))
      } finally {
        setSaving(null)
      }
    },
    [task, onUpdate, t],
  )

  if (!board || visible.length === 0) return null

  return (
    <div className="space-y-3" data-testid="project-fields-section">
      {visible.map(field => (
        <TaskFieldRow key={field.id} label={field.name} align="center">
          <FieldEditor
            field={field}
            value={task.fields?.[field.id] ?? null}
            disabled={readOnly || saving === field.id}
            onSave={value => save(field, value)}
            clearLabel={t("tasks.projectFields.clear")}
            emptyLabel={t("tasks.projectFields.empty")}
          />
        </TaskFieldRow>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

interface EditorProps {
  field: ProjectFieldSchemaEntry
  value: string | number | null
  disabled: boolean
  onSave: (value: string | number | null) => void
  clearLabel: string
  emptyLabel: string
}

/** The sentinel for "no value" inside a Select, which cannot hold an empty string. */
const NONE = "__none__"

function FieldEditor({ field, value, disabled, onSave, clearLabel, emptyLabel }: EditorProps) {
  switch (field.dataType) {
    case "single_select": {
      const options = optionChoices(field)
      return (
        <Select
          disabled={disabled}
          value={typeof value === "string" ? value : NONE}
          onValueChange={next => onSave(next === NONE ? null : next)}
        >
          <SelectTrigger aria-label={field.name}>
            <SelectValue placeholder={emptyLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{clearLabel}</SelectItem>
            {options.map(option => (
              <SelectItem key={option.id} value={option.id}>
                <span className="flex items-center gap-2">
                  {option.color && (
                    <span
                      aria-hidden
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: `#${String(option.color).replace(/^#/, "")}` }}
                    />
                  )}
                  {option.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    case "iteration": {
      const choices = orderIterationChoices(field.iterations)
      return (
        <Select
          disabled={disabled}
          value={typeof value === "string" ? value : NONE}
          onValueChange={next => onSave(next === NONE ? null : next)}
        >
          <SelectTrigger aria-label={field.name}>
            <SelectValue placeholder={emptyLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{clearLabel}</SelectItem>
            {choices.map(iteration => (
              <SelectItem key={iteration.id} value={iteration.id}>
                {/* A completed iteration stays selectable but reads as past, so a
                    task already pointing at one still shows its title. */}
                <span className={iteration.completed ? "theme-text-muted" : undefined}>{iteration.title}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    case "number":
      return (
        <Input
          type="number"
          aria-label={field.name}
          disabled={disabled}
          defaultValue={typeof value === "number" ? String(value) : ""}
          placeholder={emptyLabel}
          onBlur={event => {
            const raw = event.target.value.trim()
            if (raw === "") return onSave(null)
            const parsed = Number(raw)
            if (Number.isFinite(parsed)) onSave(parsed)
          }}
        />
      )

    case "date":
      return (
        <Input
          type="date"
          aria-label={field.name}
          disabled={disabled}
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={event => {
            const raw = event.target.value.trim()
            onSave(raw === "" ? null : raw)
          }}
        />
      )

    default:
      return (
        <Input
          type="text"
          aria-label={field.name}
          disabled={disabled}
          defaultValue={typeof value === "string" ? value : ""}
          placeholder={emptyLabel}
          onBlur={event => {
            const raw = event.target.value
            onSave(raw === "" ? null : raw)
          }}
        />
      )
  }
}
