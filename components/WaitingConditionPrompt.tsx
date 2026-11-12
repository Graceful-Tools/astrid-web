"use client"

/**
 * The Waiting prompt (Jon, 2026-11-12): a task moved into Waiting must wait for something — a
 * date, or another task — so the person is asked which, and whether to keep it assigned.
 *
 * Opened by lib/waiting-prompt.ts `requestWaitingCondition` through components/WaitingPromptHost.tsx,
 * which loads this module only when a prompt is asked for, so it adds nothing to a page's first load. A Radix dialog, so focus is trapped inside it and returns where it
 * came from. Escape cancels THIS prompt only: the keydown stops here, so a task pane behind it
 * does not close too. Cancel leaves the task where it was.
 *
 * "Waiting on…" is the existing blocker picker's search: lib/task-search-client.ts (server-side,
 * permission-filtered) ranked by lib/task-dependencies.ts `rankBlockerCandidates`.
 */
import { useEffect, useId, useState } from "react"
import { useSession } from "next-auth/react"
import { CalendarDays, Triangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslations } from "@/lib/i18n/client"
import { fillMessage } from "@/components/shared/RichMessage"
import {
  MIN_TASK_SEARCH_LENGTH,
  TASK_SEARCH_DEBOUNCE_MS,
  searchTasks,
  type TaskSearchHit,
} from "@/lib/task-search-client"
import { rankBlockerCandidates } from "@/lib/task-dependencies"
import {
  type WaitingChoice,
  type WaitingPromptRequest,
  type WaitingPromptTask,
} from "@/lib/waiting-prompt-bus"

type Mode = "date" | "task"

const pad = (n: number) => String(n).padStart(2, "0")
/** A local calendar day as `YYYY-MM-DD`. */
const dayOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** The earliest day that is still in the future: tomorrow. Today's all-day date has already begun. */
function tomorrow(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return dayOf(date)
}

/** The task's own date, as a day, when it is still ahead — the prompt's starting value. */
function initialDay(task: WaitingPromptTask): string {
  if (!task.dueDateTime) return ""
  const due = new Date(task.dueDateTime)
  if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) return ""
  // An all-day date is midnight UTC; read its day in UTC so it does not shift a day west of Greenwich.
  return task.isAllDay ? due.toISOString().slice(0, 10) : dayOf(due)
}

/** The dialog itself; loaded on demand by components/WaitingPromptHost.tsx. */
export default function WaitingConditionDialog({ request }: { request: WaitingPromptRequest }) {
  const { t } = useTranslations()
  const { data: session } = useSession()
  const { task } = request
  const formId = useId()

  const [mode, setMode] = useState<Mode>("date")
  const [day, setDay] = useState(() => initialDay(task))
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<TaskSearchHit[]>([])
  const [picked, setPicked] = useState<TaskSearchHit | null>(null)
  const [keepAssignee, setKeepAssignee] = useState(false)

  const assigneeId = task.assignee?.id ?? task.assigneeId ?? null
  const viewerId = session?.user?.id ?? null
  const keepLabel =
    !assigneeId || assigneeId === viewerId
      ? t("waiting.prompt.keepAssignedToMe")
      : fillMessage(t("waiting.prompt.keepAssignedTo"), {
          name: task.assignee?.name || task.assignee?.email || t("waiting.prompt.theAssignee"),
        })

  const [minDay] = useState(tomorrow)
  const dayValid = day !== "" && day >= minDay
  const canConfirm = mode === "date" ? dayValid : picked !== null

  useEffect(() => {
    const trimmed = query.trim()
    if (mode !== "task" || trimmed.length < MIN_TASK_SEARCH_LENGTH) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const found = await searchTasks(trimmed)
        if (cancelled) return
        setHits(
          rankBlockerCandidates({
            hits: found.filter(hit => !hit.completed),
            taskId: task.id,
            taskListIds: (task.lists ?? []).map(list => list.id),
            excludedIds: [],
          }),
        )
      } catch {
        if (!cancelled) setHits([])
      }
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [mode, query, task.id, task.lists])

  // A short query shows nothing, whatever the last search found.
  const shownHits = query.trim().length >= MIN_TASK_SEARCH_LENGTH ? hits : []

  const cancel = () => request.resolve(null)
  const confirm = () => {
    if (!canConfirm) return
    const choice: WaitingChoice =
      mode === "date"
        ? { mode: "date", dueDateTime: `${day}T00:00:00.000Z`, keepAssignee }
        : { mode: "task", waitOnTaskId: (picked as TaskSearchHit).id, keepAssignee }
    request.resolve(choice)
  }

  const tabClass = (selected: boolean) =>
    `flex-1 inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg text-sm font-medium transition-all duration-fast ${
      selected ? "bg-brand text-brand-foreground" : "bg-transparent border-2 border-theme-button text-theme-secondary"
    }`

  return (
    <Dialog open onOpenChange={open => { if (!open) cancel() }}>
      <DialogContent
        className="theme-bg-secondary theme-border max-w-md"
        data-testid="waiting-prompt"
        // Escape belongs to this prompt alone: Radix closes it, and nothing behind it hears the key.
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.stopPropagation()
            event.nativeEvent.stopImmediatePropagation()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="theme-text-primary">{t("waiting.prompt.title")}</DialogTitle>
          <DialogDescription className="theme-text-secondary">
            {task.title ? fillMessage(t("waiting.prompt.descriptionFor"), { title: task.title }) : t("waiting.prompt.description")}
          </DialogDescription>
        </DialogHeader>

        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={event => {
            event.preventDefault()
            confirm()
          }}
        >
          <div className="flex gap-2" role="radiogroup" aria-label={t("waiting.prompt.title")}>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "date"}
              data-testid="waiting-prompt-mode-date"
              onClick={() => setMode("date")}
              className={tabClass(mode === "date")}
            >
              <CalendarDays className="w-4 h-4" />
              {t("waiting.prompt.until")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "task"}
              data-testid="waiting-prompt-mode-task"
              onClick={() => setMode("task")}
              className={tabClass(mode === "task")}
            >
              <Triangle className="w-4 h-4 rotate-180" />
              {t("waiting.prompt.on")}
            </button>
          </div>

          {mode === "date" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${formId}-day`} className="text-sm theme-text-secondary">
                {t("waiting.prompt.dateLabel")}
              </label>
              <Input
                id={`${formId}-day`}
                type="date"
                autoFocus
                min={minDay}
                value={day}
                data-testid="waiting-prompt-date"
                onChange={event => setDay(event.target.value)}
                aria-invalid={day !== "" && !dayValid}
              />
              {day !== "" && !dayValid && (
                <p className="text-sm text-danger" role="alert">{t("waiting.prompt.dateInPast")}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${formId}-search`} className="text-sm theme-text-secondary">
                {t("waiting.prompt.taskLabel")}
              </label>
              <Input
                id={`${formId}-search`}
                type="text"
                autoFocus
                value={query}
                data-testid="waiting-prompt-search"
                placeholder={t("tasks.waitingOn.searchPlaceholder")}
                onChange={event => setQuery(event.target.value)}
              />
              {picked && (
                <p className="text-sm theme-text-primary" data-testid="waiting-prompt-picked">
                  {fillMessage(t("waiting.prompt.picked"), {
                    task: `${picked.identifier ? `${picked.identifier} · ` : ""}${picked.title}`,
                  })}
                </p>
              )}
              {query.trim().length >= MIN_TASK_SEARCH_LENGTH && shownHits.length === 0 && (
                <span className="text-sm theme-text-secondary">{t("tasks.waitingOn.noResults")}</span>
              )}
              <div className="flex flex-col max-h-48 overflow-y-auto" role="listbox" aria-label={t("waiting.prompt.taskLabel")}>
                {shownHits.map(hit => (
                  <button
                    key={hit.id}
                    type="button"
                    role="option"
                    aria-selected={picked?.id === hit.id}
                    onClick={() => setPicked(hit)}
                    className={`text-left text-sm px-3 py-2 rounded-lg theme-surface-hover ${
                      picked?.id === hit.id ? "theme-bg-selected" : ""
                    }`}
                  >
                    {hit.identifier ? `${hit.identifier} · ` : ""}
                    {hit.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {assigneeId && (
            <label className="flex items-center gap-2 text-sm theme-text-primary">
              <Checkbox
                checked={keepAssignee}
                data-testid="waiting-prompt-keep-assignee"
                onCheckedChange={value => setKeepAssignee(value === true)}
              />
              {keepLabel}
            </label>
          )}
        </form>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={cancel} data-testid="waiting-prompt-cancel">
            {t("actions.cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={!canConfirm}
            data-testid="waiting-prompt-confirm"
            className="bg-brand hover:bg-brand-hover text-brand-foreground"
          >
            {t("waiting.prompt.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
