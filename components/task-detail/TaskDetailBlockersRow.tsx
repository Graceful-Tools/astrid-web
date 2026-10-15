"use client"

/**
 * The "waiting on" row in task details — task-to-task blocking (AWTD-1002).
 *
 * Spec: docs/specs/TASK_BLOCKING_DEPENDENCIES.md. Its own component for the
 * reason `TaskDetailBoardStateRow` is: the chips, the search picker and the
 * writes are one idea, and `TaskFieldEditors` is not allowed to grow.
 *
 * Renders nothing unless `showsTaskBlockers` says so — that rule is stated once
 * beside the board-state row's, so iOS and Mac copy it rather than re-deciding
 * it.
 *
 * ONE TO THREE, WITHOUT A THREE ANYWHERE. Chips wrap and the row grows: there
 * is no slice, no "+2 more" and no MAX_BLOCKERS. One to three is what this row
 * is designed to read well at, not a limit the code may assume — ten blockers
 * render as ten chips, which is honest and rare. The picker stays open between
 * picks for the same reason: adding two or three in a row is the common case.
 */
import { useCallback, useEffect, useState } from "react"
import { Plus, Triangle, X } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { Badge } from "@/components/ui/badge"
import { useTranslations } from "@/lib/i18n/client"
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api"
import {
  MIN_TASK_SEARCH_LENGTH,
  TASK_SEARCH_DEBOUNCE_MS,
  searchTasks,
  type TaskSearchHit as SearchHit,
} from "@/lib/task-search-client"
import {
  isTaskInProject,
  showsTaskBlockers,
} from "@/lib/task-detail-project-state"
import { rankBlockerCandidates, type BlockerView } from "@/lib/task-dependencies"
import type { Task, TaskList } from "@/types/task"

interface TaskDetailBlockersRowProps {
  task: Task
  availableLists: TaskList[]
  readOnly: boolean
}

export function TaskDetailBlockersRow({
  task,
  availableLists,
  readOnly,
}: TaskDetailBlockersRowProps) {
  const { t } = useTranslations()
  const [blockedBy, setBlockedBy] = useState<BlockerView[]>([])
  // Tasks that already wait on this one, transitively: choosing any of them
  // would close a cycle the server refuses, so the picker never offers them.
  const [dependentIds, setDependentIds] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [error, setError] = useState<string | null>(null)
  // The server refused this user Project Mode (403 `not_granted`): every write
  // would be refused too, so the row is not drawn at all (AWTD-1039).
  const [notGranted, setNotGranted] = useState(false)
  const inProject = isTaskInProject(task, availableLists)

  const load = useCallback(async () => {
    try {
      const response = await apiGet(`/api/v1/tasks/${task.id}/blockers`)
      const body = (await response.json()) as { blockedBy?: BlockerView[]; dependentIds?: string[] }
      setBlockedBy(body.blockedBy ?? [])
      setDependentIds(body.dependentIds ?? [])
    } catch (err) {
      // A read that fails shows an empty row rather than an error banner: the
      // blockers are not the reason the pane was opened.
      setBlockedBy([])
      setDependentIds([])
      if (err instanceof ApiError && (err.detail as { reason?: string } | null)?.reason === 'not_granted') {
        setNotGranted(true)
      }
    }
  }, [task.id])

  // Off a board the row never draws, so asking would only collect a refusal
  // from the Project Mode gate for every task a non-board user opens (AWTD-1039).
  useEffect(() => {
    if (!inProject) return
    void load()
  }, [load, inProject])

  // The picker is the EXISTING search — server-side, permission-filtered, and
  // already paginated. Filtering loaded tasks client-side is the bug 5df85b9f
  // fixed, and a second search path would be a second set of permission rules.
  useEffect(() => {
    if (!picking) return
    const trimmed = query.trim()
    if (trimmed.length < MIN_TASK_SEARCH_LENGTH) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const tasks = await searchTasks(trimmed)
        if (cancelled) return
        // Never offer a choice the write would refuse — the task itself,
        // anything already linked, anything that would cycle — and put this
        // board's tasks first, since most blockers are neighbours.
        setHits(
          rankBlockerCandidates({
            hits: tasks,
            taskId: task.id,
            taskListIds: (task.lists ?? []).map(list => list.id),
            excludedIds: [...blockedBy.map(blocker => blocker.id), ...dependentIds],
          })
        )
      } catch {
        if (!cancelled) setHits([])
      }
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [picking, query, task.id, task.lists, blockedBy, dependentIds])

  const add = async (blockingTaskId: string) => {
    setError(null)
    try {
      await apiPost(`/api/v1/tasks/${task.id}/blockers`, { blockingTaskId })
      await load()
    } catch (err) {
      // A cycle is refused server-side; saying so is the only way the person
      // learns why nothing happened.
      const reason = err instanceof ApiError ? (err.detail as { reason?: string } | null)?.reason : undefined
      setError(reason === 'dependency_cycle' ? t('tasks.waitingOn.cycleError') : t('tasks.waitingOn.addError'))
    }
  }

  const remove = async (blockingTaskId: string) => {
    setError(null)
    try {
      await apiDelete(`/api/v1/tasks/${task.id}/blockers/${blockingTaskId}`)
      await load()
    } catch {
      setError(t('tasks.waitingOn.addError'))
    }
  }

  // After the hooks: a conditional return above them would change the hook
  // order between renders as the blockers load.
  if (
    notGranted ||
    !showsTaskBlockers({
      isInProject: inProject,
      isReadOnly: readOnly,
      hasBlockers: blockedBy.length > 0,
    })
  ) {
    return null
  }

  return (
    // A yield sign: an inverted triangle, outlined and muted like every other
    // row icon (AWTD-1007). iOS, Mac and Windows draw the same shape.
    <TaskFieldRow
      label={t('tasks.waitingOn.label')}
      icon={<Triangle data-testid="waiting-on-icon" className="w-4 h-4 rotate-180" />}
    >
      <div className="flex flex-col gap-2" data-testid="task-detail-blockers">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('tasks.waitingOn.label')}>
          {blockedBy.length === 0 && (
            <span className="text-sm theme-text-secondary">
              {t('tasks.waitingOn.empty')}
            </span>
          )}
          {/* Listed the way the Lists row lists lists: the same Badge, so a
              blocker reads as a thing the task is attached to. */}
          {blockedBy.map(blocker => (
            <Badge
              key={blocker.id}
              variant="secondary"
              data-testid={`task-blocker-${blocker.id}`}
              className={`flex items-center gap-1 ${readOnly ? '' : 'pr-1'} ${
                blocker.completed ? 'line-through opacity-60' : ''
              }`}
            >
              {/* A blocker you cannot see still blocks. The COUNT is not a
                  leak — the reader already knows something holds their task —
                  but the title would be, and so would its id. */}
              {blocker.hidden ? (
                t('tasks.waitingOn.hidden')
              ) : (
                <>
                  {/* Outside the link, so the link's name stays the title. */}
                  {blocker.identifier && (
                    <span className="font-mono opacity-70">{blocker.identifier}</span>
                  )}
                  {/* The same task link a `!task` reference renders (lib/markdown.ts). */}
                  <a href={`/?task=${encodeURIComponent(blocker.id)}`} className="hover:underline">
                    {blocker.title}
                  </a>
                </>
              )}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={t('tasks.waitingOn.remove')}
                  onClick={() => remove(blocker.id)}
                  className="ml-1 hover:bg-black/20 rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </Badge>
          ))}
          {!readOnly && (
            <button
              type="button"
              data-testid="task-detail-add-blocker"
              onClick={() => setPicking(value => !value)}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-sm font-medium border-2 border-dashed theme-border theme-text-secondary"
            >
              <Plus className="w-3 h-3" />
              {t('tasks.waitingOn.add')}
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {picking && !readOnly && (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('tasks.waitingOn.searchPlaceholder')}
              aria-label={t('tasks.waitingOn.searchPlaceholder')}
              className="h-9 px-3 rounded-lg border-2 theme-border bg-transparent text-sm"
            />
            {query.trim().length >= 2 && hits.length === 0 && (
              <span className="text-sm theme-text-secondary">
                {t('tasks.waitingOn.noResults')}
              </span>
            )}
            {hits.map(hit => (
              <button
                key={hit.id}
                type="button"
                onClick={() => add(hit.id)}
                className="text-left text-sm px-3 py-2 rounded-lg theme-surface-hover"
              >
                {hit.identifier ? `${hit.identifier} · ` : ''}
                {hit.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </TaskFieldRow>
  )
}
