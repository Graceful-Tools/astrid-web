import type { Task } from "@/types/task"

export type TaskSortBy = "auto" | "priority" | "when" | "assignee" | "completed" | "incomplete" | "manual"

export function compareTasksBySort(
  a: Task,
  b: Task,
  sortBy: TaskSortBy | string | null | undefined,
  manualOrderMap?: Map<string, number> | null,
): number {
  switch (sortBy) {
    case "priority":
      return (b.priority || 0) - (a.priority || 0)

    case "when": {
      const aDate = a.when || a.dueDate
      const bDate = b.when || b.dueDate
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      return new Date(aDate).getTime() - new Date(bDate).getTime()
    }

    case "assignee": {
      const aName = a.assignee?.name || a.assignee?.email || "Unassigned"
      const bName = b.assignee?.name || b.assignee?.email || "Unassigned"
      return aName.localeCompare(bName)
    }

    case "completed":
      if (a.completed === b.completed) return 0
      return a.completed ? 1 : -1

    case "incomplete":
      if (a.completed === b.completed) return 0
      return a.completed ? -1 : 1

    case "manual": {
      if (!manualOrderMap) {
        const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return aCreated - bCreated
      }
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
    const fallback = tasks
      .filter(task => !knownIds.has(task.id))
      .sort((taskA, taskB) => {
        const aCreated = taskA.createdAt ? new Date(taskA.createdAt).getTime() : 0
        const bCreated = taskB.createdAt ? new Date(taskB.createdAt).getTime() : 0
        return aCreated - bCreated
      })
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
