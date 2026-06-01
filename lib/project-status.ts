/**
 * Project status board model.
 *
 * A project status board renders columns for a project: a virtual Inbox, the
 * project's real status lists (Ready / Doing / Waiting and any custom statuses),
 * and a virtual Done column. Inbox and Done are derived from task state — they
 * are not real lists. See docs/product/project-status-board.md for the full
 * spec.
 *
 * Invariants enforced here and at the API boundary:
 *   completed = true  =>  no project-status list memberships
 *   status set        =>  completed = false
 *   Inbox             =  completed = false AND no project-status list
 *   Done              =  completed = true
 */
import type { Task, TaskList } from '@/types/task'

export type ProjectStatusRole = 'ready' | 'doing' | 'waiting' | 'custom'

export interface ProjectStatusDefinition {
  role: ProjectStatusRole
  name: string
  description: string
  order: number
}

export const DEFAULT_PROJECT_STATUSES: ProjectStatusDefinition[] = [
  {
    role: 'ready',
    name: 'Ready',
    description: 'Time to get to work!',
    order: 0,
  },
  {
    role: 'doing',
    name: 'Doing',
    description: 'Active work in progress!',
    order: 1,
  },
  {
    role: 'waiting',
    name: 'Waiting',
    description: 'Paused until the circumstances are right.',
    order: 2,
  },
]

export const VIRTUAL_INBOX_COLUMN_ID = '__virtual_inbox__'
export const VIRTUAL_DONE_COLUMN_ID = '__virtual_done__'

export type ProjectBoardColumnKind = 'inbox' | 'status' | 'done'

export interface ProjectBoardColumn {
  id: string
  name: string
  description: string
  kind: ProjectBoardColumnKind
  statusList?: TaskList
}

const VIRTUAL_INBOX_COLUMN: Omit<ProjectBoardColumn, 'id'> & { id: typeof VIRTUAL_INBOX_COLUMN_ID } = {
  id: VIRTUAL_INBOX_COLUMN_ID,
  name: 'Inbox',
  description: 'Move them to "Ready" when they are... ready!',
  kind: 'inbox',
}

const VIRTUAL_DONE_COLUMN: Omit<ProjectBoardColumn, 'id'> & { id: typeof VIRTUAL_DONE_COLUMN_ID } = {
  id: VIRTUAL_DONE_COLUMN_ID,
  name: 'Done',
  description: 'Complete — congrats!',
  kind: 'done',
}

/** True when the list is a project status list (Ready / Doing / Waiting / custom). */
export function isProjectStatusList(list: Pick<TaskList, 'listType'> | null | undefined): boolean {
  return list?.listType === 'status'
}

/**
 * Legacy: early projects seeded a real "Done" status list. New projects don't.
 * Treat any such list as a Done-bucket so the virtual Done column owns those
 * tasks instead of rendering a duplicate column.
 */
export function isLegacyDoneStatusList(
  list: Pick<TaskList, 'listType' | 'statusRole' | 'statusCompleted'> | null | undefined,
): boolean {
  return isProjectStatusList(list) && (list?.statusRole === 'done' || list?.statusCompleted === true)
}

/** Legacy mirror of {@link isLegacyDoneStatusList} for the old Inbox status list. */
export function isLegacyInboxStatusList(
  list: Pick<TaskList, 'listType' | 'statusRole'> | null | undefined,
): boolean {
  return isProjectStatusList(list) && list?.statusRole === 'inbox'
}

/**
 * Returns the user's real status lists in display order, excluding any
 * legacy Inbox/Done lists (the board renders virtual columns for those).
 *
 * Status lists are now **per-user globals** — one Ready/Doing/Waiting set
 * shared across every project board, not duplicated per project. A
 * project's board is the intersection of that project's domain tasks
 * with these global statuses. `getProjectStatusLists` therefore takes no
 * project id — every board renders the same status columns.
 */
export function getProjectStatusLists(lists: TaskList[]): TaskList[] {
  return lists
    .filter(list => isProjectStatusList(list))
    .filter(list => !isLegacyDoneStatusList(list) && !isLegacyInboxStatusList(list))
    .sort((a, b) => {
      const aOrder = typeof a.statusOrder === 'number' ? a.statusOrder : Number.MAX_SAFE_INTEGER
      const bOrder = typeof b.statusOrder === 'number' ? b.statusOrder : Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.name.localeCompare(b.name)
    })
}

/**
 * Build the ordered board columns: [virtual Inbox, ...real statuses, virtual Done].
 * The board renders this output 1:1.
 */
export function getProjectBoardColumns(lists: TaskList[]): ProjectBoardColumn[] {
  const statuses = getProjectStatusLists(lists)
  return [
    { ...VIRTUAL_INBOX_COLUMN },
    ...statuses.map<ProjectBoardColumn>(status => ({
      id: status.id,
      name: status.name,
      description: status.statusDescription || status.description || '',
      kind: 'status',
      statusList: status,
    })),
    { ...VIRTUAL_DONE_COLUMN },
  ]
}

/**
 * Returns the board column id a task currently belongs to:
 *   completed=true              → virtual Done id
 *   has a real status list      → that list's id
 *   otherwise                   → virtual Inbox id
 */
export function getTaskProjectColumnId(task: Task, lists: TaskList[]): string {
  if (task.completed) return VIRTUAL_DONE_COLUMN_ID

  const statusLists = getProjectStatusLists(lists)
  const taskListIds = new Set(task.lists?.map(list => list.id) || [])
  const explicit = statusLists.find(status => taskListIds.has(status.id))
  if (explicit) return explicit.id

  return VIRTUAL_INBOX_COLUMN_ID
}

/**
 * Compute the post-move task state when dragging a task onto a board column.
 *   inbox  → strip the (global) status, completed=false
 *   done   → strip the (global) status, completed=true
 *   status → replace any existing status with the target, completed=false
 * Regular (non-status) list memberships are preserved in all cases.
 */
export function resolveProjectColumnMove(
  task: Task,
  targetColumn: ProjectBoardColumn,
  lists: TaskList[],
): { listIds: string[]; completed: boolean } {
  const statusIds = new Set(
    lists.filter(list => isProjectStatusList(list)).map(list => list.id),
  )
  const retainedListIds = task.lists.map(list => list.id).filter(id => !statusIds.has(id))

  if (targetColumn.kind === 'inbox') {
    return { listIds: retainedListIds, completed: false }
  }
  if (targetColumn.kind === 'done') {
    return { listIds: retainedListIds, completed: true }
  }
  return {
    listIds: [...retainedListIds, targetColumn.id],
    completed: false,
  }
}

/**
 * Server-side guard: take a requested set of list memberships and clamp it to
 * the board invariants.
 *
 * Status is now a single per-user global concept, so a task has **at most one
 * status list** total (not one per project).
 *
 * - completed=true: drops every status list from the request (Done has no
 *   status membership).
 * - completed=false (default): keeps at most one status list (last one in the
 *   request wins) and reports `completedFromStatus: false` so the API can
 *   force-clear completed when a status is being applied.
 *
 * The function is pure: it never reads from the database.
 */
export function normalizeProjectStatusListIds(
  requestedListIds: string[],
  knownLists: TaskList[],
  options: { completed?: boolean } = {},
): { listIds: string[]; completedFromStatus?: boolean } {
  const allStatusIds = new Set(knownLists.filter(isProjectStatusList).map(list => list.id))

  // When the task is being marked done, strip every status membership.
  if (options.completed === true) {
    return {
      listIds: Array.from(new Set(requestedListIds.filter(id => !allStatusIds.has(id)))),
    }
  }

  const statusInRequest = requestedListIds.filter(id => allStatusIds.has(id))
  if (statusInRequest.length === 0) {
    return { listIds: Array.from(new Set(requestedListIds)) }
  }

  // Keep at most one status list — the last one in the request wins.
  const winningStatus = statusInRequest[statusInRequest.length - 1]
  const nonStatus = requestedListIds.filter(id => !allStatusIds.has(id))

  return {
    listIds: Array.from(new Set([...nonStatus, winningStatus])),
    completedFromStatus: false,
  }
}

/**
 * Tasks that should appear on a project's board: those attached to at least
 * one of the project's regular (non-status) lists. A task with only a status
 * membership and no domain list isn't a "project task" and is excluded.
 */
export function getProjectDomainTasks(tasks: Task[], lists: TaskList[], projectId: string): Task[] {
  const projectRegularListIds = new Set(
    lists
      .filter(list => list.projectId === projectId && list.listType !== 'status')
      .map(list => list.id),
  )

  return tasks.filter(task =>
    task.lists?.some(list => projectRegularListIds.has(list.id)),
  )
}

/**
 * Narrow a project's domain tasks to the board's current scope (sub-task #4).
 * - `list`  (default): only tasks in the selected domain list.
 * - `project`: every task across the project's lists, aggregated by status.
 *
 * If the selected list is not one of the project's domain lists (e.g. a shared
 * status list), the project-wide set is returned regardless of scope, since
 * there is no single list to narrow to.
 */
export function scopeProjectBoardTasks(
  projectTasks: Task[],
  selectedList: TaskList | undefined,
  projectId: string,
  boardScope: 'list' | 'project',
): Task[] {
  const isDomainList =
    selectedList?.projectId === projectId && selectedList.listType !== 'status'
  if (boardScope === 'list' && isDomainList && selectedList) {
    return projectTasks.filter(task =>
      task.lists?.some(list => list.id === selectedList.id),
    )
  }
  return projectTasks
}
