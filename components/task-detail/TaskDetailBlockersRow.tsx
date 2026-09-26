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
import { Hourglass, Plus, X } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { useTranslations } from "@/lib/i18n/client"
import { apiDelete, apiGet, apiPost } from "@/lib/api"
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

interface SearchHit {
  id: string
  title: string
  identifier?: string | null
  lists?: Array<{ id: string }> | null
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

  const load = useCallback(async () => {
    try {
      const response = await apiGet(`/api/v1/tasks/${task.id}/blockers`)
      const body = (await response.json()) as { blockedBy?: BlockerView[]; dependentIds?: string[] }
      setBlockedBy(body.blockedBy ?? [])
      setDependentIds(body.dependentIds ?? [])
    } catch {
      // A read that fails shows an empty row rather than an error banner: the
      // blockers are not the reason the pane was opened.
      setBlockedBy([])
      setDependentIds([])
    }
  }, [task.id])

  useEffect(() => {
    void load()
  }, [load])

  // The picker is the EXISTING search — server-side, permission-filtered, and
  // already paginated. Filtering loaded tasks client-side is the bug 5df85b9f
  // fixed, and a second search path would be a second set of permission rules.
  useEffect(() => {
    if (!picking) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const response = await apiGet(`/api/v1/search?q=${encodeURIComponent(trimmed)}`)
        const body = (await response.json()) as { tasks?: SearchHit[] }
        if (cancelled) return
        // Never offer a choice the write would refuse — the task itself,
        // anything already linked, anything that would cycle — and put this
        // board's tasks first, since most blockers are neighbours.
        setHits(
          rankBlockerCandidates({
            hits: body.tasks ?? [],
            taskId: task.id,
            taskListIds: (task.lists ?? []).map(list => list.id),
            excludedIds: [...blockedBy.map(blocker => blocker.id), ...dependentIds],
          })
        )
      } catch {
        if (!cancelled) setHits([])
      }
    }, 200)
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
      const reason = (err as { data?: { reason?: string } })?.data?.reason
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
    !showsTaskBlockers({
      isInProject: isTaskInProject(task, availableLists),
      isReadOnly: readOnly,
      hasBlockers: blockedBy.length > 0,
    })
  ) {
    return null
  }

  return (
    <TaskFieldRow label={t('tasks.waitingOn.label')} icon={<Hourglass className="w-4 h-4" />}>
      <div className="flex flex-col gap-2" data-testid="task-detail-blockers">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('tasks.waitingOn.label')}>
          {blockedBy.length === 0 && (
            <span className="text-sm theme-text-secondary">
              {t('tasks.waitingOn.empty')}
            </span>
          )}
          {blockedBy.map(blocker => (
            <span
              key={blocker.id}
              data-testid={`task-blocker-${blocker.id}`}
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg text-sm font-medium border-2 ${
                blocker.completed
                  ? 'theme-border theme-text-muted line-through'
                  : 'theme-border theme-text-primary'
              }`}
            >
              {/* A blocker you cannot see still blocks. The COUNT is not a
                  leak — the reader already knows something holds their task —
                  but the title would be. */}
              {blocker.hidden ? (
                t('tasks.waitingOn.hidden')
              ) : (
                // The same task link a `!task` reference renders (lib/markdown.ts).
                <a href={`/?task=${encodeURIComponent(blocker.id)}`} className="hover:underline">
                  {blocker.title}
                </a>
              )}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={t('tasks.waitingOn.remove')}
                  onClick={() => remove(blocker.id)}
                  className="theme-text-secondary hover:theme-text-primary"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
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
