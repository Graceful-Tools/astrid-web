/**
 * The multi-list project board (AWTD-1660): each chosen list is a row (a
 * swimlane) and the board's status columns stay columns.
 *
 * Pure and client-safe. Which column a card is in is NOT decided here: it is
 * `getTaskProjectColumnId` against `getProjectBoardColumns`, the same pair the
 * single-list board uses, so a card cannot sit in one column on a list's board
 * and another on its project's board.
 *
 * Which lists are rows is saved per person per project on the server
 * (`ProjectBoardView`, GET/PUT /api/v1/projects/:id/board-rows). `null` means
 * nothing saved yet, and the board shows the project's own lists; `[]` is a
 * board the person emptied on purpose.
 */
import type { Task, TaskList } from '@/types/task'
import { isDomainList } from '@/lib/list-flavors'
import { getTaskProjectColumnId, type ProjectBoardColumn } from '@/lib/project-status'
import { isTaskRecentlyCompleted, type RecentlyCompletedWindow } from '@/lib/recently-completed-window'
import { sortTasksForList } from '@/lib/task-sort'

export { PROJECT_BOARD_LIST_DRAG_TYPE, readDraggedListId } from '@/lib/project-board-list-drag'

/** The most rows one board may save (the API refuses more). */
export const PROJECT_BOARD_MAX_ROWS = 100

/** The project's own domain lists, in the order the lists arrive. */
export function defaultBoardRowListIds(projectId: string, lists: TaskList[]): string[] {
  return lists
    .filter(list => list.projectId === projectId && isDomainList(list))
    .map(list => list.id)
}

/**
 * The lists to draw as rows. Saved ids the person can no longer see, repeats,
 * and anything that is not a domain list (status rows, labels) are dropped.
 */
export function resolveBoardRows(
  savedListIds: string[] | null,
  projectId: string,
  lists: TaskList[],
): TaskList[] {
  const ids = savedListIds ?? defaultBoardRowListIds(projectId, lists)
  const byId = new Map(lists.filter(isDomainList).map(list => [list.id, list]))
  const seen = new Set<string>()
  const rows: TaskList[] = []
  for (const id of ids) {
    const list = byId.get(id)
    if (!list || seen.has(id)) continue
    seen.add(id)
    rows.push(list)
  }
  return rows
}

export function addBoardRow(rowIds: string[], listId: string): string[] {
  return rowIds.includes(listId) ? rowIds : [...rowIds, listId]
}

export function removeBoardRow(rowIds: string[], listId: string): string[] {
  return rowIds.filter(id => id !== listId)
}

/** Lists that could be added: domain lists that are not rows yet. */
export function boardRowCandidates(lists: TaskList[], rowIds: string[]): TaskList[] {
  const rows = new Set(rowIds)
  const seen = new Set<string>()
  return lists
    .filter(list => isDomainList(list) && !list.isVirtual && !rows.has(list.id))
    .filter(list => (seen.has(list.id) ? false : (seen.add(list.id), true)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

export interface BoardSwimlane {
  list: TaskList
  /** Column id → the row's cards in that column, sorted the list's way. */
  cells: Record<string, Task[]>
  total: number
}

/**
 * Group cards into rows × columns. A card on two row lists shows in both rows.
 * Done keeps to each row list's "recently completed" window, as the list's own
 * board does.
 */
export function buildSwimlanes(
  rows: TaskList[],
  tasks: Task[],
  columns: ProjectBoardColumn[],
  options: { now?: Date } = {},
): BoardSwimlane[] {
  const now = options.now ?? new Date()
  return rows.map(list => {
    const window = (list.recentlyCompletedWindow ?? null) as RecentlyCompletedWindow | null
    const inRow = tasks.filter(task =>
      task.lists?.some(member => member.id === list.id) &&
      (!task.completed || isTaskRecentlyCompleted(task, window, now)),
    )
    const manualOrder = Array.isArray(list.manualSortOrder)
      ? (list.manualSortOrder as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined
    const sorted = sortTasksForList(inRow, list.sortBy || 'auto', manualOrder)

    const cells: Record<string, Task[]> = Object.fromEntries(columns.map(column => [column.id, [] as Task[]]))
    for (const task of sorted) cells[getTaskProjectColumnId(task, columns)]?.push(task)
    return { list, cells, total: sorted.length }
  })
}
