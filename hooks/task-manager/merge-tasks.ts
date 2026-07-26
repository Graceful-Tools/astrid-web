/**
 * Reconciling a server response into the rendered task list.
 *
 * The two modes are genuinely different and conflating them loses data:
 *
 *   full   the response IS the truth — anything absent no longer exists
 *   delta  the response is a patch — anything absent is simply unchanged
 *
 * Treating a delta like a full response would wipe every task the delta didn't
 * mention, which is why the reconcile stayed a ~1.9 MB full fetch until the API
 * learned to report `deletedIds`.
 */

import type { Task } from '@/types/task'

export interface MergeOptions {
  /** True when the request carried `updatedSince`. */
  isDelta: boolean
  /** Ids the server reports as deleted since the cursor. */
  deletedIds: string[]
}

/** Carry over comments loaded on demand in the detail view when the server omits them. */
function withPreservedComments(serverTask: Task, existing: Task | undefined): Task {
  const existingComments = existing?.comments
  if (existingComments && existingComments.length > 0 && !serverTask.comments) {
    return { ...serverTask, comments: existingComments }
  }
  return serverTask
}

export function mergeTasks(prev: Task[], incoming: Task[], options: MergeOptions): Task[] {
  const { isDelta, deletedIds } = options
  const prevById = new Map(prev.map(task => [task.id, task]))
  const deleted = new Set(deletedIds)

  if (!isDelta) {
    // Full response: it is the complete picture. Keep only optimistic rows the
    // server has not seen yet.
    const serverIds = new Set(incoming.map(task => task.id))
    const optimistic = prev.filter(task => !serverIds.has(task.id) && task.id.startsWith('temp-'))
    const merged = incoming.map(task => withPreservedComments(task, prevById.get(task.id)))
    return [...merged, ...optimistic]
  }

  // Delta: start from what is on screen, apply updates, then removals.
  const byId = new Map(prevById)
  for (const task of incoming) {
    byId.set(task.id, withPreservedComments(task, prevById.get(task.id)))
  }
  // Deletion wins over an update in the same batch, so a race cannot resurrect
  // a task the server has already dropped.
  for (const id of deleted) byId.delete(id)

  return Array.from(byId.values())
}

/**
 * Same reconciliation for lists. Lists carry no comments, so this is the task
 * merge without that concern — kept as its own export so call sites read
 * clearly rather than passing a flag.
 */
export function mergeLists<T extends { id: string }>(
  prev: T[],
  incoming: T[],
  options: MergeOptions,
): T[] {
  const { isDelta, deletedIds } = options

  if (!isDelta) {
    const serverIds = new Set(incoming.map(list => list.id))
    const optimistic = prev.filter(list => !serverIds.has(list.id) && list.id.startsWith('temp-'))
    return [...incoming, ...optimistic]
  }

  const byId = new Map(prev.map(list => [list.id, list]))
  for (const list of incoming) byId.set(list.id, list)
  for (const id of deletedIds) byId.delete(id)
  return Array.from(byId.values())
}
