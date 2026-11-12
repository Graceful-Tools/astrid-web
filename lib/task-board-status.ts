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
import { isDefaultStatusRole, parseCustomStates } from '@/lib/task-status'

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

/** The ids of the boards a task is on: its lists' own `projectId`, or a project that lists them. */
function boardIdsFor(task: BoardStatusTask, projects: readonly BoardStatusProject[]): string[] {
  const lists = (task.lists ?? []).filter((list): list is { id: string; projectId?: string | null } => list != null)
  const ids = new Set<string>()
  for (const list of lists) {
    if (list.projectId) ids.add(list.projectId)
  }
  const listIds = new Set(lists.map(list => list.id))
  for (const project of projects) {
    if ((project.lists ?? []).some(list => listIds.has(list.id))) ids.add(project.id)
  }
  return [...ids]
}

export function taskBoardStatus(
  task: BoardStatusTask,
  projects: readonly BoardStatusProject[] = [],
): TaskBoardStatus | null {
  const boardIds = boardIdsFor(task, projects)
  if (boardIds.length === 0) return null

  const role = task.statusRole ?? ''
  let kind: TaskBoardStatusKind
  if (task.completed) kind = 'done'
  else if (!role) kind = 'inbox'
  else kind = isDefaultStatusRole(role) ? (role as TaskBoardStatusKind) : 'custom'

  const lookupRole = kind === 'custom' ? role : kind
  let boardName: string | null = null
  for (const id of boardIds) {
    const project = projects.find(candidate => candidate.id === id)
    const state = parseCustomStates(project?.customStates).find(
      candidate => candidate.role === lookupRole,
    )
    if (state) {
      boardName = state.name
      break
    }
  }

  if (kind === 'custom' && !boardName) return null
  return { kind, boardName }
}
