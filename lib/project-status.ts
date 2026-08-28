/**
 * Project status board model.
 *
 * A board renders: a virtual Inbox, the three default status columns, the
 * board's own custom columns, and a virtual Done. See
 * docs/product/project-status-board.md for the full spec.
 *
 * **No column is a row.** Status began as membership in a `listType: 'status'`
 * TaskList; AWTD-562 moved it to `Task.statusRole`, and Stage D
 * (task b7b0c2f5) deleted the rows. The defaults are `DEFAULT_STATES` config
 * and a board's customs are `Project.customStates` — so a column id is always
 * a ROLE, and the only thing that says which column a card is in is the field
 * on the card.
 *
 * That is what makes two members of a shared board agree: the role lives on
 * the shared task, so each member maps it onto their own column of that role.
 * The list model could not do that without duplicating a Ready/Doing/Waiting
 * set per user per project — which shipped twice and was reverted twice.
 *
 * Invariants enforced here and at the API boundary:
 *   status set  =>  completed = false
 *   Inbox       =  completed = false AND statusRole is null
 *   Done        =  completed = true
 */
import type { Task, TaskList } from '@/types/task'
import { DEFAULT_STATES, parseCustomStates, isDefaultStatusRole } from '@/lib/task-status'

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

/**
 * True when the list is a leftover `listType: 'status'` row.
 *
 * Nothing creates these any more and the migration deleted every one, but a
 * client can still be holding them in a list set fetched before the deploy.
 * Used only to STRIP such a membership on write — never to decide which
 * column a card is in.
 */
export function isProjectStatusList(list: Pick<TaskList, 'listType'> | null | undefined): boolean {
  return list?.listType === 'status'
}

/**
 * Build the ordered board columns: [virtual Inbox, ...statuses, virtual Done].
 * The board renders this output 1:1.
 *
 * Takes only the board's `Project.customStates` (task b346e377). It used to
 * take the user's lists as well, to find the row backing each column; Stage D
 * removed the rows, and with them the only reason a column id could be
 * anything but its role.
 */
export function getProjectBoardColumns(customStates?: unknown): ProjectBoardColumn[] {
  const allCustomStates = parseCustomStates(customStates)
  // Built-in overrides (e.g. renamed defaults) stored alongside custom states.
  const defaultOverrides = new Map(
    allCustomStates.filter(s => isDefaultStatusRole(s.role)).map(s => [s.role, s]),
  )
  const customs = allCustomStates.filter(s => !isDefaultStatusRole(s.role))

  const defaults = DEFAULT_STATES.map<ProjectBoardColumn>(state => ({
    id: state.role,
    name: defaultOverrides.get(state.role)?.name ?? state.name,
    description: state.description || '',
    kind: 'status',
  }))

  const customCols = customs.map<ProjectBoardColumn>(state => ({
    id: state.role,
    name: state.name,
    description: state.description || '',
    kind: 'status',
  }))

  return [
    { ...VIRTUAL_INBOX_COLUMN },
    ...defaults,
    ...customCols,
    { ...VIRTUAL_DONE_COLUMN },
  ]
}

/**
 * The project board a selected list belongs to, if any.
 *
 * Lived in components/project-status-board.tsx until task 036ef139 gave the
 * LIST view a second reason to ask the question, and moved here so both callers
 * import it from one place.
 */
export function getProjectIdForBoard(lists: TaskList[], selectedListId: string): string | null {
  const selectedList = lists.find(list => list.id === selectedListId)
  return selectedList?.projectId || null
}

/**
 * Everything a task ROW needs to offer the board's status picker, or null when
 * the selected list has no board (task 036ef139).
 *
 * Bundled rather than derived per row for two reasons. The columns are the same
 * for every row in the list, so building them once is the cheaper shape; and
 * `projectId`, `lists` and `columns` have to agree — a row resolving its current
 * column against one project while its buttons came from another would render a
 * picker with nothing selected.
 */
export interface BoardRowContext {
  projectId: string
  /**
   * Needed only to strip a stale `listType: 'status'` membership on a move.
   * The card's CURRENT column comes from `columns` + its own `statusRole`.
   */
  lists: TaskList[]
  columns: ProjectBoardColumn[]
}

export function getBoardRowContext(
  lists: TaskList[],
  selectedListId: string,
  /**
   * The board's `Project.customStates`, threaded straight through to
   * `getProjectBoardColumns` (task 9ddf4a6f). Without it the row picker shows
   * only the three defaults, so the LIST view and the BOARD disagree about
   * one board's columns.
   */
  customStates?: unknown,
): BoardRowContext | null {
  const projectId = getProjectIdForBoard(lists, selectedListId)
  if (!projectId) return null
  return { projectId, lists, columns: getProjectBoardColumns(customStates) }
}

/**
 * Returns the board column id a task currently belongs to:
 *   completed = true         → virtual Done
 *   statusRole has a column  → that column
 *   otherwise                → virtual Inbox
 *
 * Resolved against the board's COLUMNS, not against the user's lists. That is
 * the whole point of Stage D: a card's column is a function of a field on the
 * shared card and the board's own configuration, so two members cannot
 * disagree, and no cached row can put a card somewhere the server would not.
 *
 * An unmatched role falls to Inbox rather than being returned bare. A card
 * whose column id matches no rendered column is in NONE of them — silently
 * gone from the board while still present in the list view. Reachable for a
 * custom role on a board whose `customStates` have not loaded. Showing a card
 * in the wrong column is recoverable; losing it is not.
 */
export function getTaskProjectColumnId(
  task: Task,
  columns: ProjectBoardColumn[],
): string {
  if (task.completed) return VIRTUAL_DONE_COLUMN_ID

  const role = (task as { statusRole?: string | null }).statusRole
  if (!role) return VIRTUAL_INBOX_COLUMN_ID

  const match = columns.find(column => column.kind === 'status' && column.id === role)
  return match ? match.id : VIRTUAL_INBOX_COLUMN_ID
}

/**
 * What the board's add-task form should SEND for a new task in this column
 * (task eb7fce2f).
 *
 * The status column travels as a ROLE, never as a list id — same rule
 * resolveProjectColumnMove states below, learned the hard way twice now: the
 * rows behind columns are gone since Stage D, and a role inside `listIds`
 * makes POST reject the whole create ("Invalid list IDs: ready"), which is how
 * adding a task to a board column silently broke across that deploy.
 *
 * `listIds` is undefined (not []) when there is no domain list: an empty array
 * means "in no list", undefined lets the creator fall back to its default —
 * different writes.
 */
export function resolveProjectColumnCreate(
  column: ProjectBoardColumn,
  domainListId: string | undefined,
): { listIds: string[] | undefined; statusRole: string | undefined } {
  return {
    listIds: domainListId ? [domainListId] : undefined,
    statusRole: column.kind === 'status' ? column.id : undefined,
  }
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
  // Strips any leftover `listType: 'status'` membership the client is still
  // holding. The rows are deleted server-side, but a session open across the
  // deploy has them cached, and leaving one attached would keep the card
  // rendering in its old column for anything that still reads membership.
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
    // Never appended. The column id is a ROLE and the rows are gone, so a
    // membership here would be a dangling id — and PUT /tasks/[id] rejects the
    // whole write when one list in `listIds` does not exist, which is how a
    // drag silently stops working across a deploy.
    listIds: retainedListIds,
    completed: false,
    statusRole: targetColumn.id,
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
 * The status memberships a task must shed when it is completed — the other
 * half of `completed = true => no status memberships` (task db7c6670).
 *
 * {@link normalizeProjectStatusListIds} already enforces this, but only for
 * requests that carry `listIds`. Every route gates it behind
 * `if (body.listIds !== undefined)`, so a completion-only update — `PUT
 * { completed: true }`, which is what the checkbox, the API and the scripts
 * send — skipped it and left the membership in place, writing a *new*
 * violation each time. (Reproduced on production 2026-08-02.)
 *
 * Takes the task's CURRENT lists and returns the ids to detach, so the caller
 * can disconnect them without having to restate the full membership set.
 *
 * Pure: never reads from the database.
 */
export function statusListIdsToDetachOnCompletion(
  // Loose on purpose: Prisma selects widen `listType` to `string`, and the
  // callers are route handlers passing partial selections.
  currentLists: { id: string; listType?: string | null }[] | null | undefined,
): string[] {
  if (!Array.isArray(currentLists)) return []
  return currentLists
    .filter(list => isProjectStatusList(list as Pick<TaskList, 'listType'>))
    .map(list => list.id)
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
