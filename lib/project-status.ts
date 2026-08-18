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
import { DEFAULT_STATES, parseCustomStates } from '@/lib/task-status'

/** The roles that always have a column, list-backed or not. */
const DEFAULT_ROLES = new Set(DEFAULT_STATES.map(state => state.role))

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
 * **Scope depends on the role** — and this comment used to describe an
 * arrangement that was reverted, so read it rather than assuming:
 *
 * - **The three defaults** (ready / doing / waiting) are **per-user
 *   singletons**, `projectId: null`, shared across every board the user has.
 *   Making them per-project is what produced nine status lists for a
 *   two-board user; that shipped twice and was reverted twice.
 * - **Custom states** are **per-project** (task 109d8a91): a custom column
 *   belongs to one board and must not leak onto another, so it is kept only
 *   when its `projectId` matches the board being rendered.
 *
 * The two-member disagreement this once had to solve — Alice drags a card to
 * Doing, Bob resolves against his own lists and sees Inbox — is now handled by
 * `Task.statusRole` instead (AWTD-562). The role lives on the shared task, so
 * each member maps it onto their own column of that role and both land on the
 * same column name. What remains is only a task carrying a membership and no
 * field, which goes when the status lists do (2e41c645).
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
  /**
   * The board's `Project.customStates` — the durable home for custom columns
   * (task b346e377). Optional because callers that have not been plumbed
   * through yet must keep rendering exactly the columns they render today.
   */
  customStates?: unknown,
): ProjectBoardColumn[] {
  const statuses = getProjectStatusLists(lists, projectId)
  const byRole = new Map<string, TaskList>(
    statuses.flatMap(status => (status.statusRole ? [[status.statusRole as string, status] as const] : [])),
  )

  // The three defaults come from CONFIG, backed by a list when one exists
  // (task a1722040 step 4). Deriving the whole board from the rows meant the
  // day they are dropped the board would render Inbox and Done and nothing
  // else. Web no longer depends on them existing; the eventual deletion is a
  // no-op here rather than a cliff.
  //
  // The column id stays the LIST id while a list backs the role, because the
  // membership dual-write keys off it and older clients still read membership.
  // Once the rows are gone the id is the role itself.
  const defaults = DEFAULT_STATES.map<ProjectBoardColumn>(state => {
    const backing = byRole.get(state.role)
    return {
      id: backing?.id ?? state.role,
      // A renamed default is a PUT on the list, so the list's name wins while
      // the rows exist.
      name: backing?.name ?? state.name,
      description: backing?.statusDescription || backing?.description || state.description || '',
      kind: 'status',
      statusList: backing,
    }
  })

  // Custom columns come from the PROJECT (task b346e377), merged BY ROLE with
  // any legacy row. Three populations have to render correctly at once:
  // states written since the writer landed (JSON + row), boards that predate
  // it (row only), and boards after the rows are dropped (JSON only). Merging
  // on anything but the role gives the first population two headers with the
  // same name and a card that can only be in one of them.
  const legacyCustoms = statuses.filter(status => !DEFAULT_ROLES.has(status.statusRole ?? ''))
  const legacyByRole = new Map<string, TaskList>(
    legacyCustoms.flatMap(status =>
      status.statusRole ? [[status.statusRole as string, status] as const] : [],
    ),
  )

  const stored = parseCustomStates(customStates)
  const storedColumns = stored.map<ProjectBoardColumn>(state => {
    const backing = legacyByRole.get(state.role)
    return {
      // The membership dual-write targets the LIST id, so the role becomes the
      // id only once no row backs it. Switching early sends drops at a list
      // that does not exist.
      id: backing?.id ?? state.role,
      // The project is the durable copy; a row's name can be stale.
      name: state.name,
      description: state.description || backing?.statusDescription || backing?.description || '',
      kind: 'status',
      statusList: backing,
    }
  })

  const storedRoles = new Set(stored.map(state => state.role))
  const unmigrated = legacyCustoms
    .filter(status => !storedRoles.has(status.statusRole ?? ''))
    .map<ProjectBoardColumn>(status => ({
      id: status.id,
      name: status.name,
      description: status.statusDescription || status.description || '',
      kind: 'status',
      statusList: status,
    }))

  const customs = [...storedColumns, ...unmigrated]

  return [
    { ...VIRTUAL_INBOX_COLUMN },
    ...defaults,
    ...customs,
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
  /** Needed to resolve the task's current column and its move. */
  lists: TaskList[]
  columns: ProjectBoardColumn[]
}

export function getBoardRowContext(
  lists: TaskList[],
  selectedListId: string,
  /**
   * The board's `Project.customStates`, threaded straight through to
   * `getProjectBoardColumns` (task 9ddf4a6f). Without it only legacy
   * row-backed customs reach the row picker, so the LIST view and the BOARD
   * disagree about one board's columns — and once Stage D drops the rows the
   * picker loses custom states altogether.
   */
  customStates?: unknown,
): BoardRowContext | null {
  const projectId = getProjectIdForBoard(lists, selectedListId)
  if (!projectId) return null
  return { projectId, lists, columns: getProjectBoardColumns(lists, projectId, customStates) }
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
    // A default role always has a column, backed by a list or not, so a card
    // can no longer fall to Inbox merely because the rows are missing.
    if (DEFAULT_ROLES.has(statusRoleFromField)) {
      const backing = getProjectStatusLists(lists, projectId)
        .find(status => status.statusRole === statusRoleFromField)
      return backing ? backing.id : statusRoleFromField
    }
    const match = getProjectStatusLists(lists, projectId)
      .find(status => status.statusRole === statusRoleFromField)
    // Fall back to Inbox rather than returning the bare role. Board columns are
    // keyed by LIST id, so an unmatched role matches no column and the card
    // renders in NONE of them — silently gone from the board while still
    // present in the list view. Reachable whenever the status lists have not
    // loaded, and for every custom state once those ship, since a custom state
    // has no backing list. Showing a card in the wrong column is recoverable;
    // losing it is not.
    return match ? match.id : VIRTUAL_INBOX_COLUMN_ID
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
    // Only append a membership when a real list backs the column. Once the
    // status rows are gone the column id is a ROLE, and persisting that in
    // listIds would be a membership in a list that does not exist.
    listIds: targetColumn.statusList
      ? [...retainedListIds, targetColumn.statusList.id]
      : retainedListIds,
    completed: false,
    // Written alongside the membership so the field is the source of truth on
    // web while iOS still reads the list. Dual-write, not dual-truth.
    statusRole: targetColumn.statusList?.statusRole ?? targetColumn.id,
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
