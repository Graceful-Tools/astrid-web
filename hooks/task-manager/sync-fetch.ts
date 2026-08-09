/**
 * The reconcile fetch behind useTaskListState.loadData. (Task 641a7615, step 3)
 *
 * Extracted from the hook because the fetching is where the failure modes are,
 * and they are not testable through a React tree and a fake IndexedDB.
 *
 * Two things this has to get right, both of which fail silently:
 *
 * - **v1 caps `/api/v1/tasks` at 100 rows**; legacy `/api/tasks` had no cap.
 *   Swapping the path without paging would hand every user their first 100
 *   tasks and nothing else — no error, no empty state, just tasks that are not
 *   there. `fetchAllPages` (decision 1B) exists for exactly this.
 * - **`deletedIds` has to survive paging.** A delta that drops page 2's
 *   deletions leaves deleted tasks resurrected in the local cache.
 *
 * `isDelta` is carried out separately rather than inferred downstream because
 * `mergeTasks` treats a full response as the truth and a delta as a patch —
 * getting it backwards wipes every task the response did not mention.
 *
 * v1 `/api/v1/lists` does not paginate today (it reports `meta.total` as the
 * row count and takes no `limit`), but it goes through the same helper: if it
 * ever gains a cap, this keeps returning every row instead of quietly losing
 * the tail.
 */

import { fetchAllPages } from '@/lib/api-paginate'
import { buildTaskSyncUrl } from './load-from-cache'

export interface SyncPayload {
  tasks: unknown[]
  lists: unknown[]
  deletedTaskIds: string[]
  deletedListIds: string[]
  tasksIsDelta: boolean
  listsIsDelta: boolean
  /** True when the page cap stopped a walk early — the caller must not treat it as a full sync. */
  truncated: boolean
}

export interface FetchSyncPayloadOptions {
  /** Injectable for tests; defaults to the app's fetch wrapper at the call site. */
  fetchImpl?: typeof fetch
}

export async function fetchSyncPayload(
  options: FetchSyncPayloadOptions = {}
): Promise<SyncPayload> {
  const { fetchImpl } = options

  const [tasksUrl, listsUrl] = await Promise.all([
    buildTaskSyncUrl('/api/v1/tasks', 'task'),
    buildTaskSyncUrl('/api/v1/lists', 'list'),
  ])

  const [tasksResult, listsResult] = await Promise.all([
    fetchAllPages<unknown>(tasksUrl, 'tasks', { fetchImpl, alsoCollect: 'deletedIds' }),
    fetchAllPages<unknown>(listsUrl, 'lists', { fetchImpl, alsoCollect: 'deletedIds' }),
  ])

  return {
    tasks: tasksResult.items,
    lists: listsResult.items,
    deletedTaskIds: tasksResult.collected as string[],
    deletedListIds: listsResult.collected as string[],
    tasksIsDelta: tasksUrl.includes('updatedSince='),
    listsIsDelta: listsUrl.includes('updatedSince='),
    truncated: tasksResult.truncated || listsResult.truncated,
  }
}
