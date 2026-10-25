/**
 * Hydrate the task the detail pane just opened (AWTD-1242).
 *
 * The pane renders the LIST row, and the list select carries neither
 * `attachments`/`secureFiles` nor the blockers, field values or next
 * occurrences the detail route returns. Before this, those appeared only once a
 * live event touched the task (AWTD-1040 put the full v1 shape on task events),
 * so a freshly loaded task with an attachment showed none until something
 * happened to it.
 *
 * One fetch per task per session: live events keep a task fresh after that, so
 * re-opening the same pane is not a reason to read it again. A fetch that FAILS
 * is not remembered, so re-opening retries — an offline open should not poison
 * the task for the rest of the session.
 *
 * Failures are silent, the way `TaskDetailBlockersRow` treats its own read: the
 * pane still renders everything the list row had, and nobody opened a task to
 * be told its attachments could not be counted.
 */

import { useEffect, useRef } from 'react'
import { CacheManager } from '@/lib/cache-manager'
import { applyHydratedTask, fetchTaskDetail, mergeHydratedTask } from './detail-hydrate'
import type { Task } from '@/types/task'

export interface UseTaskDetailHydrationProps {
  /** The task whose pane is open; `""` when none is. */
  selectedTaskId: string
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
}

export function useTaskDetailHydration({
  selectedTaskId,
  setTasks,
}: UseTaskDetailHydrationProps): void {
  const handled = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedTaskId) return
    // An optimistic row has no server id yet: `GET /api/v1/tasks/temp-…` is a
    // guaranteed 404. The real id arrives with the create response.
    if (selectedTaskId.startsWith('temp-')) return
    if (handled.current.has(selectedTaskId)) return
    handled.current.add(selectedTaskId)

    let cancelled = false

    void (async () => {
      const hydrated = await fetchTaskDetail(selectedTaskId)

      if (!hydrated) {
        // Not remembered as handled, so opening the pane again retries.
        handled.current.delete(selectedTaskId)
        return
      }
      if (cancelled) return

      setTasks(prev => applyHydratedTask(prev, hydrated))

      // Write through so a return visit paints from IndexedDB with the detail
      // fields already on it. Merged onto the cached row rather than replacing
      // it — `setTask` stores a task whole.
      try {
        const cached = await CacheManager.getTask(selectedTaskId)
        await CacheManager.setTask(
          cached?.data ? mergeHydratedTask(cached.data, hydrated) : hydrated
        )
      } catch {
        // The cache is an optimisation; rendered state is already correct.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedTaskId, setTasks])
}
