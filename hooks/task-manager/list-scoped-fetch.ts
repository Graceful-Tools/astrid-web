/**
 * The tasks of a list the user is viewing but does not belong to — a public or
 * featured list — read by `GET /api/v1/tasks?listId=` (AWTD-1451 step 1).
 *
 * The web used to draw these lists by filtering the global synced read, which
 * only had their tasks because the no-`listId` read ORs in every PUBLIC list
 * in the database. That clause is the cost AWTD-1451 removes (step 2); this is
 * what lets it go without opening those lists empty. iOS featured views
 * already fetch this way.
 *
 * Offline: a successful read is written to the IndexedDB `publicTasks` table,
 * one list at a time, and a failed read falls back to it — so a list opened
 * before still shows, as it did when its rows sat in the global cache.
 */

import { fetchAllPages } from '@/lib/api-paginate'
import { OfflinePublicTaskOperations } from '@/lib/offline-db'
import type { Task } from '@/types/task'
import { mergeTasks } from './merge-tasks'

export interface FetchListTasksOptions {
  /** Injectable for tests; the hook passes the app's `apiGet`. */
  fetchImpl?: typeof fetch
}

export async function fetchListTasks(listId: string, options: FetchListTasksOptions = {}): Promise<Task[]> {
  try {
    const { items } = await fetchAllPages<Task>(
      `/api/v1/tasks?listId=${encodeURIComponent(listId)}`,
      'tasks',
      { fetchImpl: options.fetchImpl },
    )
    // Best-effort: an unavailable IndexedDB must not cost the user the list.
    await OfflinePublicTaskOperations.replaceListTasks(listId, items).catch(() => undefined)
    return items
  } catch (error) {
    const cached = await OfflinePublicTaskOperations.getListTasks(listId).catch(() => [] as Task[])
    if (cached.length > 0) return cached
    throw error
  }
}

/**
 * Fold one list's fetched tasks into the rendered tasks. A patch, not the
 * truth: rows of other lists are untouched. A row that is gone from this list
 * is removed only when this list was its only one — a task that is also in one
 * of the user's own lists is the global read's to keep or drop.
 */
export function mergeListTasks(prev: Task[], listId: string, fetched: Task[]): Task[] {
  const fetchedIds = new Set(fetched.map(task => task.id))
  const deletedIds = prev
    .filter(task =>
      !fetchedIds.has(task.id) &&
      !task.id.startsWith('temp-') &&
      (task.lists?.length ?? 0) > 0 &&
      task.lists!.every(list => list.id === listId))
    .map(task => task.id)
  return mergeTasks(prev, fetched, { isDelta: true, deletedIds })
}
