/**
 * The client's one way to search tasks: `/api/v1/search` — server-side,
 * permission-filtered, and it matches identifiers (`AWTD-12`) as well as
 * titles. The Waiting-on picker and the `!` mention picker both use it, so
 * the two cannot find different tasks (AWTD-1002, AWTD-1017).
 */
import { apiGet } from '@/lib/api'

export interface TaskSearchHit {
  id: string
  title: string
  identifier?: string | null
  completed?: boolean
  lists?: Array<{ id: string; name?: string }> | null
}

/** Below this the picker shows local suggestions instead of searching. */
export const MIN_TASK_SEARCH_LENGTH = 2
export const TASK_SEARCH_DEBOUNCE_MS = 200

export async function searchTasks(query: string): Promise<TaskSearchHit[]> {
  const response = await apiGet(`/api/v1/search?q=${encodeURIComponent(query)}`)
  const body = (await response.json()) as { tasks?: TaskSearchHit[] }
  return body.tasks ?? []
}
