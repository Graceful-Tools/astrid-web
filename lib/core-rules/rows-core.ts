/**
 * Saved list views ordered by astrid-core's `rows` door (AWTD-1663; Jon, 2026-11-18: saved views
 * only).
 *
 * `rows` is the whole list pipeline — filter, sort, splice subtasks — in one request, the one iOS
 * and the Mac draw from. It takes a list's SAVED settings (or My Tasks' preferences), while web
 * filters on live, unsaved edits and also has universal search, the public pseudo-list and
 * virtual lists, none of which the door covers. So the door is asked only for a view whose live
 * filters are exactly its saved ones:
 *
 * - a real list, showing its saved completion filter and sort, with no priority, assignee or
 *   due-date filter (web never loads those three from a list; they start empty, so the request
 *   sends them cleared — what web shows, not what the row in the database says);
 * - My Tasks, whose filters ARE its saved preferences.
 *
 * And core decides only the ORDER. The TypeScript still filters; core's answer is used only when
 * it names exactly the tasks the TypeScript kept. A different set — a filter the two read
 * differently, a task shape core refuses — leaves the TypeScript's list on screen, so adopting the
 * door can reorder a view but never add or drop a task from it.
 */
import type { Task, TaskList } from '@/types/task'

export type SavedView =
  | {
      kind: 'list'
      list: TaskList
      completion: string
      sortBy: string
      manualOrder?: string[]
    }
  | {
      kind: 'myTasks'
      preferences: {
        filterPriority: number[]
        filterAssignee: string[]
        filterDueDate: string
        filterCompletion: string
        sortBy: string
        manualSortOrder: string[]
      }
    }

/** What a live filter state must look like to be a saved view (see the header). */
export interface LiveFilters {
  search: string
  completed: string
  priority: number[]
  assignee: string[]
  dueDate: string
  sortBy: string
}

/**
 * The saved view this filter state is, or null when the door must not be asked (search, public,
 * a virtual list, or any live edit away from the list's saved settings).
 */
export function savedViewFor(args: {
  selectedListId: string
  currentList: TaskList | undefined
  filters: LiveFilters
  savedCompletion: string
  savedSortBy: string
  manualOrder?: string[]
}): SavedView | null {
  const { selectedListId, currentList, filters, savedCompletion, savedSortBy, manualOrder } = args
  if (filters.search.trim()) return null
  if (selectedListId === 'my-tasks') {
    return {
      kind: 'myTasks',
      preferences: {
        filterPriority: filters.priority,
        filterAssignee: filters.assignee,
        filterDueDate: filters.dueDate,
        filterCompletion: filters.completed,
        sortBy: filters.sortBy,
        manualSortOrder: manualOrder ?? [],
      },
    }
  }
  if (selectedListId === 'public' || !currentList || currentList.virtualListType) return null
  if (filters.priority.length > 0 || filters.assignee.length > 0 || filters.dueDate !== 'all') return null
  if (filters.completed !== savedCompletion || filters.sortBy !== savedSortBy) return null
  return { kind: 'list', list: currentList, completion: filters.completed, sortBy: filters.sortBy, manualOrder }
}

/** Core's order for `view` over `candidates`, or null when it cannot answer. Never throws. */
export function coreOrderedIds(args: {
  runJson: (request: string) => string
  view: SavedView
  candidates: Task[]
  lists: TaskList[]
  currentUserId: string | undefined
  now: Date
}): string[] | null {
  const { runJson, view, candidates, lists, currentUserId, now } = args
  const request: Record<string, unknown> = {
    kind: 'rows',
    tasks: candidates,
    lists,
    currentUserId,
    idsOnly: true,
    now: now.toISOString(),
    utcOffsetMinutes: -now.getTimezoneOffset(),
  }
  if (view.kind === 'myTasks') {
    request.myTasks = view.preferences
  } else {
    request.list = {
      ...view.list,
      filterCompletion: view.completion,
      sortBy: view.sortBy,
      manualSortOrder: view.manualOrder ?? view.list.manualSortOrder ?? null,
      filterPriority: null,
      filterAssignee: null,
      filterDueDate: null,
      filterAssignedBy: null,
      filterRepeating: null,
      filterInLists: null,
    }
  }
  try {
    const reply = JSON.parse(runJson(JSON.stringify(request))) as { ok: boolean; value?: { ids?: unknown } }
    const ids = reply.ok ? reply.value?.ids : undefined
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? (ids as string[]) : null
  } catch {
    return null
  }
}

/**
 * `ordered` in core's order when core named exactly the same tasks; otherwise `ordered` as it is.
 */
export function orderLikeCore(ordered: Task[], coreIds: string[] | null): Task[] {
  if (!coreIds || coreIds.length !== ordered.length) return ordered
  const byId = new Map(ordered.map((task) => [task.id, task]))
  if (byId.size !== ordered.length || new Set(coreIds).size !== coreIds.length) return ordered
  const reordered: Task[] = []
  for (const id of coreIds) {
    const task = byId.get(id)
    if (!task) return ordered
    reordered.push(task)
  }
  return reordered
}
