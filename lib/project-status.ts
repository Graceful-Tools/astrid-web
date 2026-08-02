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
import { statusListsForUser } from '@/lib/status-lists'

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
 * Returns the status lists for a board, in display order, excluding any legacy
 * Inbox/Done lists (the board renders virtual columns for those).
 *
 * **Scope-aware** (task 142e4dd9). Status lists come in two flavours:
 *
 * - **Personal** (`projectId: null`) — the user's own Ready/Doing/Waiting set,
 *   shared across all of their solo boards. This is the original behaviour and
 *   is still what a single-player board uses.
 * - **Project-scoped** (`projectId` set) — one set owned by the project, so
 *   every member resolves the *same* column ids.
 *
 * A shared board must use the project-scoped set. When statuses were per-user
 * only, Alice dragging a card to Doing put it in *Alice's private Doing list*;
 * Bob, resolving against his own status lists, found no match and saw the card
 * fall back to Inbox. Two people, one board, silently different columns.
 *
 * Passing a `projectId` prefers that project's own statuses and falls back to
 * the personal set when the project hasn't been promoted (solo boards, and
 * shared boards in the window before the lazy promotion runs).
 */
export function getProjectStatusLists(lists: TaskList[], projectId?: string | null): TaskList[] {
  const statuses = lists
    .filter(list => isProjectStatusList(list))
    .filter(list => !isLegacyDoneStatusList(list) && !isLegacyInboxStatusList(list))

  // One set per user, deduplicated by role (see lib/status-lists.ts). The
  // per-project variant this used to prefer is what produced nine status
  // lists for a user with two boards.
  const scoped = statusListsForUser(statuses as never, projectId) as typeof statuses

  return scoped.sort((a, b) => {
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
export function getProjectBoardColumns(
  lists: TaskList[],
  projectId?: string | null,
): ProjectBoardColumn[] {
  const statuses = getProjectStatusLists(lists, projectId)
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
export function getTaskProjectColumnId(
  task: Task,
  lists: TaskList[],
  projectId?: string | null,
): string {
  if (task.completed) return VIRTUAL_DONE_COLUMN_ID

  // Status is a STATE on the task (AWTD-562). Prefer the field: it lives on the
  // shared task, so two members of a board cannot resolve different columns —
  // the failure the list model could not fix without duplicating lists.
  //
  // The membership fallback below stays only for the transition: a client
  // holding tasks fetched before the backfill, and iOS, still carry status as a
  // list membership. It goes when the status lists do.
  const statusRoleFromField = (task as { statusRole?: string | null }).statusRole
  if (statusRoleFromField) {
    const match = getProjectStatusLists(lists, projectId)
      .find(status => status.statusRole === statusRoleFromField)
    return match ? match.id : statusRoleFromField
  }

  const statusLists = getProjectStatusLists(lists, projectId)
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
): { listIds: string[]; completed: boolean; statusRole: string | null } {
  // Strips status memberships of *both* scopes — personal and project-scoped —
  // so moving a card on a promoted board also clears the stale personal status
  // it may still carry from before the project was promoted. A task must never
  // end up in two columns.
  const statusIds = new Set(
    lists.filter(list => isProjectStatusList(list)).map(list => list.id),
  )
  const retainedListIds = task.lists.map(list => list.id).filter(id => !statusIds.has(id))

  if (targetColumn.kind === 'inbox') {
    return { listIds: retainedListIds, completed: false, statusRole: null }
  }
  if (targetColumn.kind === 'done') {
    return { listIds: retainedListIds, completed: true, statusRole: null }
  }
  return {
    listIds: [...retainedListIds, targetColumn.id],
    completed: false,
    // Written alongside the membership so the field is the source of truth on
    // web while iOS still reads the list. Dual-write, not dual-truth.
    statusRole: targetColumn.statusList?.statusRole ?? null,
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
