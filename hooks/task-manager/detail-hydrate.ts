/**
 * The single-task read behind the detail pane (AWTD-1242).
 *
 * Web had two full reads of `/api/v1/tasks` and no read of
 * `/api/v1/tasks/{id}`: the pane renders whatever the LIST payload happened to
 * carry, and the list select does not carry what the detail route does —
 * `attachments`, `secureFiles`, `blockedBy`/`blocks`, `fieldValues`,
 * `nextOccurrences`. The detail route says what that costs where it defines its
 * own shape: a response that drops them "does not render fewer attachments — it
 * renders none".
 *
 * Those fields did arrive eventually, by a different route: AWTD-1040 made live
 * task events carry the full v1 shape, so a task was hydrated as soon as
 * anything touched it. Before the first event, a freshly loaded task with an
 * attachment showed none — `TaskActivitySection` reads
 * `collectTaskAttachments(task)` straight off the prop.
 *
 * Extracted from the hook for the reason `sync-fetch.ts` was: the fetching and
 * the merge are where the failure modes live, and they are not worth testing
 * through a React tree.
 *
 * Deliberately additive. Nothing here makes the list reads leaner — that is
 * AWTD-1236's step 2, and it has to teach the cache write path to treat an
 * absent field as *unchanged* before any read may omit one.
 */

import { apiGet } from '@/lib/api'
import { unwrapTask } from '@/lib/v1-response'
import type { Task } from '@/types/task'

export interface FetchTaskDetailOptions {
  /** Injectable for tests; the app's fetch wrapper otherwise. */
  fetchImpl?: typeof fetch
}

/**
 * The full task from `GET /api/v1/tasks/{id}`, or `null` if it cannot be had.
 *
 * `null` rather than a throw: every caller's answer to a failure is the same —
 * keep rendering the list row. A 404 is an ordinary outcome here, since a task
 * can be deleted in another tab while its pane is open.
 *
 * The response is `{ task, meta }`, unwrapped with `unwrapTask` rather than by
 * hand: reading the body as the task itself yields `undefined` with no error,
 * which is the mistake `tests/rules/v1-envelope-callsites.test.ts` exists to
 * stop and that already cost this repo a script which computed an empty list
 * from `body.lists` and stripped every membership.
 */
export async function fetchTaskDetail(
  taskId: string,
  options: FetchTaskDetailOptions = {}
): Promise<Task | null> {
  const get = options.fetchImpl ?? apiGet
  try {
    const response = await get(`/api/v1/tasks/${encodeURIComponent(taskId)}`)
    if (!response.ok) return null
    const body = (await response.json()) as Parameters<typeof unwrapTask<Task>>[0]
    return unwrapTask<Task>(body)
  } catch {
    return null
  }
}

/**
 * Fold a hydrated task into the rendered list.
 *
 * Three rules, each of which is a bug if inverted:
 *
 * - **A key the response does not carry is left alone.** Absent means "not
 *   sent", never "now empty" — the same distinction the v1 list route draws for
 *   `omit=description`. An explicit `null` IS applied, because a cleared due
 *   date has to be able to clear.
 * - **A row that is not in the list is not inserted.** The pane renders from
 *   this array, so a task fetched by id and pushed in would surface in a list
 *   view it does not belong to.
 * - **Nothing changed returns the same array**, so React skips the re-render.
 */
export function applyHydratedTask(prev: Task[], hydrated: Task): Task[] {
  const index = prev.findIndex(task => task.id === hydrated.id)
  if (index === -1) return prev

  const merged = mergeHydratedTask(prev[index], hydrated)
  if (merged === prev[index]) return prev

  const next = prev.slice()
  next[index] = merged
  return next
}

/**
 * One row, hydrated onto what is already known about it.
 *
 * Shared with the cache write, which merges onto the CACHED row rather than
 * replacing it: `CacheManager.setTask` stores the task whole, so writing the
 * response straight through would drop any field the cached row had and this
 * response does not carry.
 *
 * Returns `current` itself when the patch changes nothing.
 */
export function mergeHydratedTask(current: Task, hydrated: Task): Task {
  const patch = definedFields(hydrated)
  const unchanged = Object.keys(patch).every(
    key => current[key as keyof Task] === patch[key as keyof Task]
  )
  return unchanged ? current : { ...current, ...patch }
}

/** The hydrated task's own fields, with the keys it does not carry dropped. */
function definedFields(task: Task): Partial<Task> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(task)) {
    if (value !== undefined) patch[key] = value
  }
  return patch as Partial<Task>
}
