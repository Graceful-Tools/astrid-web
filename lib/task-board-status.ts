/**
 * Which board column a task sits in, for the status pill on a LIST row
 * (AWTD-1582, the web half of iOS AITD-613).
 *
 * Jon: "In list view, add board status as a pill on the row with date and
 * other lists. Red pills for inbox, yellow for waiting, green for ready,
 * another green for doing, and a blue for done … These should not show on task
 * rows in board cards." The column header already says it there.
 *
 * The same rule as iOS/Mac `TaskBoardStatus` (astrid-ios 8f5a67e0), so the
 * three rows cannot disagree:
 *   - on no board                → no pill
 *   - completed                  → Done (whatever its role)
 *   - no role                    → Inbox
 *   - ready / doing / waiting    → that column
 *   - custom-…                   → the board's name for it (grey), or no pill
 *                                  when that name is unknown — a raw role is
 *                                  never shown to a person
 * A board's `customStates` entry for a built-in role is a rename, and wins
 * over the built-in name, as it does on the board.
 *
 * Pure: the row reads it synchronously from what it already holds.
 */
import { DEFAULT_STATES, isDefaultStatusRole, parseCustomStates } from '@/lib/task-status'

export type TaskBoardStatusKind = 'inbox' | 'ready' | 'doing' | 'waiting' | 'done' | 'custom'

export interface TaskBoardStatus {
  kind: TaskBoardStatusKind
  /** The board's own name for the column (a rename or a custom column); null means use the i18n key. */
  boardName: string | null
}

export interface BoardStatusTask {
  completed?: boolean | null
  statusRole?: string | null
  lists?: Array<{ id: string; projectId?: string | null } | null> | null
}

export interface BoardStatusProject {
  id: string
  customStates?: unknown
  lists?: Array<{ id: string }> | null
}

/** The i18n key for a built-in column's name; null for a custom column. */
export function boardStatusNameKey(kind: TaskBoardStatusKind): string | null {
  return kind === 'custom' ? null : `board.status.${kind}`
}

/** The pill's colour class (styles/components.css), from the theme's semantic tokens. */
export function boardStatusClass(kind: TaskBoardStatusKind): string {
  return `board-status-pill board-status-${kind}`
}

type ListRef = { id: string; projectId?: string | null }

/** What a row knows about boards: the synced lists and the reader's projects. */
export interface BoardStatusSource {
  /** The synced list collection; its `projectId` is authoritative when present (null = on no board). */
  lists?: readonly ListRef[] | null
  projects?: readonly BoardStatusProject[] | null
  /**
   * The board being viewed, when the row is on a board-backed list. Its column
   * names are what the row's status picker and the board itself show, so they
   * win over another board the task is also on.
   */
  board?: { projectId: string; columns: ReadonlyArray<{ id: string; name: string; kind: string }> } | null
}

/**
 * The board a list belongs to. A `projectId` field that is present — on the
 * synced list first, then on the task's own copy — decides, null included, so
 * a list moved off a board loses its pill even while a cached project still
 * names it. Project membership is consulted only when neither copy says.
 */
function boardIdForList(
  list: ListRef,
  synced: ReadonlyMap<string, ListRef>,
  projects: readonly BoardStatusProject[],
): string | null {
  const fromSync = synced.get(list.id)
  if (fromSync && 'projectId' in fromSync && fromSync.projectId !== undefined) return fromSync.projectId ?? null
  if ('projectId' in list && list.projectId !== undefined) return list.projectId ?? null
  return projects.find(project => (project.lists ?? []).some(entry => entry.id === list.id))?.id ?? null
}

function boardIdsFor(task: BoardStatusTask, source: BoardStatusSource): string[] {
  const projects = source.projects ?? []
  const synced = new Map((source.lists ?? []).map(list => [list.id, list]))
  const ids = new Set<string>()
  for (const list of task.lists ?? []) {
    if (!list) continue
    const id = boardIdForList(list, synced, projects)
    if (id) ids.add(id)
  }
  return [...ids]
}

/** The built-in English names, which mean "not renamed" when a column carries them. */
const BUILT_IN_NAMES: Record<string, string> = Object.fromEntries(
  DEFAULT_STATES.map(state => [state.role, state.name]),
)

export function taskBoardStatus(
  task: BoardStatusTask,
  source: BoardStatusSource = {},
): TaskBoardStatus | null {
  const boardIds = boardIdsFor(task, source)
  if (boardIds.length === 0) return null

  const role = task.statusRole ?? ''
  let kind: TaskBoardStatusKind
  if (task.completed) kind = 'done'
  else if (!role) kind = 'inbox'
  else kind = isDefaultStatusRole(role) ? (role as TaskBoardStatusKind) : 'custom'

  // Inbox and Done are virtual columns: always the built-in, localized name.
  if (kind === 'inbox' || kind === 'done') return { kind, boardName: null }

  // On the board being viewed, its own columns name the status.
  const board = source.board
  if (board && boardIds.includes(board.projectId)) {
    const column = board.columns.find(candidate => candidate.kind === 'status' && candidate.id === role)
    if (!column) return kind === 'custom' ? null : { kind, boardName: null }
    const renamed = column.name && column.name !== BUILT_IN_NAMES[role] ? column.name : null
    return { kind, boardName: renamed }
  }

  let boardName: string | null = null
  for (const id of boardIds) {
    const project = (source.projects ?? []).find(candidate => candidate.id === id)
    const state = parseCustomStates(project?.customStates).find(candidate => candidate.role === role)
    if (state) {
      boardName = state.name
      break
    }
  }

  if (kind === 'custom' && !boardName) return null
  return { kind, boardName }
}
