/**
 * Read side of the offline cache for the task list view.
 *
 * The app already had a Dexie/IndexedDB layer and a DataSyncManager doing
 * proper delta sync, but the render path never consulted either: loadData
 * issued four unconditional full fetches and gated the UI on them, so every
 * visit re-downloaded everything (~1.9 MB of tasks, measured in production).
 * The cache was write-only.
 *
 * These helpers are the missing read path. They are deliberately total — a
 * cache miss or an unavailable IndexedDB degrades to the old network-only
 * behaviour rather than breaking the page.
 */

import { OfflineTaskOperations, OfflineListOperations, OfflineSyncCursorOperations } from '@/lib/offline-db'
import type { Task, TaskList } from '@/types/task'

export interface SeededData {
  tasks: Task[]
  lists: TaskList[]
  /** True when the cache had something worth painting. */
  hasData: boolean
}

/**
 * Read tasks and lists straight out of IndexedDB so the first paint needs no
 * network. Never throws: private browsing, quota errors and blocked upgrades
 * all resolve to an empty result, which the caller treats as a cold start.
 */
export async function seedFromCache(): Promise<SeededData> {
  try {
    const [tasks, lists] = await Promise.all([
      OfflineTaskOperations.getTasks(),
      OfflineListOperations.getLists(),
    ])
    const safeTasks = Array.isArray(tasks) ? tasks : []
    const safeLists = Array.isArray(lists) ? lists : []
    return {
      tasks: safeTasks,
      lists: safeLists,
      hasData: safeTasks.length > 0 || safeLists.length > 0,
    }
  } catch {
    return { tasks: [], lists: [], hasData: false }
  }
}

/**
 * Add `updatedSince` to a sync URL when a cursor is on file.
 *
 * NOT yet used by loadData, deliberately: neither /api/tasks nor
 * DataSyncManager reports deletions on the incremental path (deletedIds is
 * always []), so merging a delta into rendered state would leave deleted tasks
 * on screen until the next full sync. DataSyncManager uses this shape for its
 * own IndexedDB refresh, where a stale row is harmless because the next full
 * sync overwrites it. Wire this into loadData once the API reports deletions.
 *
 * Falls back to the full URL whenever the cursor is missing or unreadable —
 * fetching too much is a performance problem, fetching too little is a
 * correctness one.
 */
export async function buildTaskSyncUrl(
  baseUrl: string,
  entity: 'task' | 'list' = 'task',
): Promise<string> {
  try {
    const cursor = await OfflineSyncCursorOperations.getCursor(entity)
    if (!cursor?.cursor) return baseUrl
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}updatedSince=${encodeURIComponent(cursor.cursor)}`
  } catch {
    return baseUrl
  }
}
