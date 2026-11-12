import type { Task } from "@/types/task"

/**
 * The orders every client reads (astrid-core `filters::sort_by_setting`, iOS's
 * `sortTasksByListSetting`). Web also sorted by `assignee`, `completed` and `incomplete`; no other
 * client had them, and since AWTD-1583 (astrid-core D33) a saved one reads as auto, as an unknown
 * order always has. `createdAt` is newest first.
 */
export type TaskSortBy = "auto" | "priority" | "when" | "completedAt" | "manual" | "createdAt"

const RETIRED_SORTS = new Set(["assignee", "completed", "incomplete"])

/** A saved order as one every client reads: a retired web-only order is `auto` (AWTD-1583). */
export function coreSortBy(value: string): string {
  return RETIRED_SORTS.has(value) ? "auto" : value
}

const createdAtOf = (task: Task) => (task.createdAt ? new Date(task.createdAt).getTime() : -Infinity)

/** Newest first; a task with no creation time last (the core reads it as the earliest instant). */
const newestFirst = (a: Task, b: Task) => {
  const [aCreated, bCreated] = [createdAtOf(a), createdAtOf(b)]
  return aCreated === bCreated ? 0 : bCreated > aCreated ? 1 : -1
}

/** Earlier due dates first; undated after every dated task. */
function dueDateOrder(a: Task, b: Task): number {
  const aDue = a.dueDateTime ? new Date(a.dueDateTime).getTime() : null
  const bDue = b.dueDateTime ? new Date(b.dueDateTime).getTime() : null
  if (aDue !== null && bDue !== null) return aDue - bDue
  if (aDue !== null) return -1
  if (bDue !== null) return 1
  return 0
}

export function compareTasksBySort(
  a: Task,
  b: Task,
  sortBy: TaskSortBy | string | null | undefined,
  manualOrderMap?: Map<string, number> | null,
): number {
  switch (sortBy) {
    case "priority":
      // iOS's order and the core's (D33, AWTD-1583): completed last, then priority, then due
      // date. It sorted by priority alone, so a finished task could sit between open ones.
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if ((a.priority || 0) !== (b.priority || 0)) return (b.priority || 0) - (a.priority || 0)
      return dueDateOrder(a, b)

    case "when": {
      // iOS's order and the core's (D33, AWTD-1325): completed last, then due
      // date with undated after, ties by priority. It read `when || dueDate`
      // until AWTD-1325 — `when` was dropped and `dueDate` is legacy, so real
      // tasks compared equal and the sort did nothing.
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return dueDateOrder(a, b) || (b.priority || 0) - (a.priority || 0)
    }

    case "createdAt":
      return newestFirst(a, b)

    case "completedAt": {
      // Most recently completed first. Completed tasks lead — the sort exists
      // to review what got done — and the open half keeps the default auto
      // ordering so it stays a usable to-do list rather than scrambling.
      if (a.completed !== b.completed) return a.completed ? -1 : 1
      if (a.completed && b.completed) {
        // completedAt is the real stamp (backdatable by sync); updatedAt is
        // the legacy fallback — same convention as the recently-completed
        // window (lib/recently-completed-window.ts).
        const aStamp = new Date(a.completedAt ?? a.updatedAt ?? 0).getTime()
        const bStamp = new Date(b.completedAt ?? b.updatedAt ?? 0).getTime()
        return bStamp - aStamp
      }
      return compareTasksBySort(a, b, "auto")
    }

    case "manual": {
      // Nothing arranged yet: newest first, the same as createdAt (D33, AWTD-1583).
      if (!manualOrderMap) return newestFirst(a, b)
      return (
        (manualOrderMap.get(a.id) ?? manualOrderMap.size) -
        (manualOrderMap.get(b.id) ?? manualOrderMap.size)
      )
    }

    case "auto":
    default: {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if ((a.priority || 0) !== (b.priority || 0)) {
        return (b.priority || 0) - (a.priority || 0)
      }
      const aDue = a.dueDateTime || a.when
      const bDue = b.dueDateTime || b.when
      if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime()
      if (aDue && !bDue) return -1
      if (!aDue && bDue) return 1
      if (a.createdAt && b.createdAt) {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }
      return a.title.localeCompare(b.title)
    }
  }
}

export function buildManualOrderMap(
  tasks: Task[],
  manualOrder: string[] | undefined,
): Map<string, number> | null {
  if (!manualOrder || manualOrder.length === 0) return null
  const map = new Map<string, number>(manualOrder.map((id, index) => [id, index]))
  const knownIds = new Set(manualOrder)
  if (map.size < tasks.length) {
    // Tasks the arrangement does not name go after it, newest first — as on iOS and in the core
    // (D33, AWTD-1583). They went oldest first, so a task created since the arrangement sank to
    // the bottom on web and rose to the top of that group everywhere else.
    const fallback = tasks
      .filter(task => !knownIds.has(task.id))
      .sort(newestFirst)
    let nextIndex = map.size
    fallback.forEach(task => {
      if (!map.has(task.id)) map.set(task.id, nextIndex++)
    })
  }
  return map
}

export function sortTasksForList(
  tasks: Task[],
  sortBy: TaskSortBy | string | null | undefined,
  manualOrder?: string[] | undefined,
): Task[] {
  const manualOrderMap = sortBy === "manual" ? buildManualOrderMap(tasks, manualOrder) : null
  return [...tasks].sort((a, b) => compareTasksBySort(a, b, sortBy, manualOrderMap))
}
