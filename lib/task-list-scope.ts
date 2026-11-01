/**
 * Which tasks a list view shows, and what a list's deletion does to tasks the
 * client already holds. Pure, so the task manager controller only wires it
 * (AWTD-1419; also keeps hooks/useTaskManagerController.ts inside its
 * oversized-files budget).
 */

import type { Task, TaskList } from "@/types/task"
import { applyVirtualListFilter } from "@/lib/virtual-list-utils"
import { isSystemListId } from "@/lib/list-permissions"

const MY_TASKS_VIEW = {
  id: "my-tasks",
  name: "My Tasks",
  isVirtual: true,
  virtualListType: "my-tasks" as const,
  filterAssignee: undefined,
  filterDueDate: undefined,
  filterCompletion: undefined,
  filterAssignedBy: undefined,
  filterPriority: undefined,
  filterInLists: undefined,
}

const inList = (listId: string) => (task: Task) => task.lists?.some(list => list.id === listId) ?? false

/**
 * The tasks the selected list's view starts from, before sort and filters.
 *
 * `currentList` is the selected list when it is one of the user's own. A real
 * list that is NOT one of theirs — a public list they are viewing — still shows
 * only its own tasks: without that, a non-member saw every public task they
 * could read under its heading (AWTD-1419). Other system views (today, public,
 * ...) are left to the filters applied after this.
 */
export function scopeTasksToList(
  tasks: Task[],
  selectedListId: string,
  currentList: TaskList | undefined,
  userId: string,
): Task[] {
  if (selectedListId === "my-tasks") {
    return applyVirtualListFilter(tasks, MY_TASKS_VIEW as unknown as TaskList, userId)
  }
  if (currentList?.isVirtual) return applyVirtualListFilter(tasks, currentList, userId)
  if (currentList || !isSystemListId(selectedListId)) return tasks.filter(inList(selectedListId))
  return tasks
}

/**
 * The list being viewed when its tasks must be fetched by `?listId=` rather
 * than read from the global sync, or null (AWTD-1451 step 1).
 *
 * That is a real list — not My Tasks, Today or another system view — that is
 * not among the user's own lists (`/api/v1/lists` returns only lists they own
 * or belong to): a public or featured list opened from the sidebar. Owned and
 * member lists return null, so their view is exactly what it was.
 */
export function foreignListIdFor(selectedListId: string, lists: TaskList[]): string | null {
  if (!selectedListId || isSystemListId(selectedListId)) return null
  return lists.some(list => list.id === selectedListId) ? null : selectedListId
}

/**
 * After a FULL reconcile, put back the viewed foreign list's rows the response
 * left out. The global read is not where they come from (AWTD-1451), so its
 * omitting them is not a deletion; the per-list refetch that follows is what
 * removes any that are really gone.
 */
export function keepListRows(prev: Task[], merged: Task[], listId: string | null): Task[] {
  if (!listId) return merged
  const present = new Set(merged.map(task => task.id))
  const kept = prev.filter(task => inList(listId)(task) && !present.has(task.id))
  return kept.length > 0 ? [...merged, ...kept] : merged
}

/**
 * The tasks with a deleted list taken off them. Deleting a list keeps its
 * tasks; if they kept the list too, the next edit of one sent it back and the
 * server refused the whole update with "Invalid list IDs" (AWTD-1419).
 */
export function withoutList(tasks: Task[], listId: string): Task[] {
  return tasks.map(task =>
    task.lists?.some(list => list.id === listId)
      ? { ...task, lists: task.lists.filter(list => list.id !== listId) }
      : task
  )
}

/** The URL of a list view: My Tasks is the home page. */
export function listPath(listId: string): string {
  return listId === "my-tasks" ? "/" : `/lists/${listId}`
}

/**
 * The URL while a task is open in a view, or the view's own URL once it closes.
 * It follows the view, not the task's first list: closing a task in My Tasks
 * used to land on /lists/<first list>, so a reload opened the wrong view (AWTD-1432).
 */
export function taskDetailPath(listId: string, taskId?: string): string {
  return taskId ? `${listPath(listId)}?task=${taskId}` : listPath(listId)
}
