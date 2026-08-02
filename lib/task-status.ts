/**
 * Task status as a STATE on the task (task AWTD-562).
 *
 * Status used to be membership in a `TaskList` with `listType: 'status'`. That
 * model could not satisfy two requirements at the same time, which is why the
 * same bug shipped twice:
 *
 *   1. One Ready/Doing/Waiting per user — or every picker fills with duplicates.
 *   2. Shared boards agree on a card's column — or collaborators silently
 *      disagree about where a card is.
 *
 * A per-user list satisfies (1) and breaks (2): the list is PRIVATE and owned
 * by one person, so a second member resolves nothing and the card falls to
 * Inbox. A per-project list satisfies (2) and breaks (1): every board adds
 * three more lists to the owner's account. Granting cross-access satisfies
 * both and leaks — the other member could then enumerate every task in that
 * list, including from boards they are not on.
 *
 * As a single field on the shared task, both hold trivially:
 *
 *   - There is no row to duplicate, so (1) cannot regress.
 *   - The value lives on the task everyone is looking at, so (2) is automatic —
 *     note that nothing here takes a viewer argument.
 *   - "At most one status per task" is true by construction rather than
 *     enforced by a normalizer and repaired by a migration.
 *
 * Inbox and Done stay derived from task state and are never stored.
 */

export const INBOX_COLUMN_ID = '__inbox__'
export const DONE_COLUMN_ID = '__done__'

export interface StatusState {
  role: string
  name: string
  description?: string
  order: number
}

/**
 * The per-user defaults, as data rather than rows. Every board shows these.
 */
export const DEFAULT_STATES: readonly StatusState[] = [
  { role: 'ready', name: 'Ready', description: 'Time to get to work!', order: 0 },
  { role: 'doing', name: 'Doing', description: 'Active work in progress!', order: 1 },
  { role: 'waiting', name: 'Waiting', description: 'Paused until the circumstances are right.', order: 2 },
]

const DEFAULT_ROLES = new Set(DEFAULT_STATES.map(state => state.role))

export type BoardColumnKind = 'inbox' | 'status' | 'done'

export interface BoardColumn {
  id: string
  name: string
  description: string
  kind: BoardColumnKind
}

export interface ProjectLike {
  id?: string
  /** Per-project custom states — a Project-Mode-only feature. */
  customStates?: unknown
}

export interface TaskLike {
  completed?: boolean | null
  statusRole?: string | null
}

/**
 * Validate a project's custom-state config.
 *
 * Tolerant by design: a malformed config returns an empty list rather than
 * throwing, because a bad row in a JSON column must never take a board down.
 *
 * A custom state may not shadow a default role — two columns with the same id
 * is the duplication class this whole change exists to remove.
 */
export function parseCustomStates(raw: unknown): StatusState[] {
  if (!Array.isArray(raw)) return []

  const byRole = new Map<string, StatusState>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const role = typeof candidate.role === 'string' ? candidate.role.trim() : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!role || !name) continue
    if (DEFAULT_ROLES.has(role)) continue
    if (byRole.has(role)) continue

    byRole.set(role, {
      role,
      name,
      description: typeof candidate.description === 'string' ? candidate.description : undefined,
      order: typeof candidate.order === 'number' ? candidate.order : byRole.size,
    })
  }

  return Array.from(byRole.values()).sort((a, b) => a.order - b.order)
}

/**
 * Ordered board columns: virtual Inbox, the defaults, the project's own custom
 * states, then virtual Done.
 *
 * Derived, so no arrangement of data can produce a duplicate column.
 */
export function boardColumnsFor(project: ProjectLike | null | undefined): BoardColumn[] {
  const customs = parseCustomStates(project?.customStates)

  return [
    { id: INBOX_COLUMN_ID, name: 'Inbox', description: 'Move them to "Ready" when they are... ready!', kind: 'inbox' },
    ...[...DEFAULT_STATES, ...customs].map<BoardColumn>(state => ({
      id: state.role,
      name: state.name,
      description: state.description ?? '',
      kind: 'status',
    })),
    { id: DONE_COLUMN_ID, name: 'Done', description: 'Complete — congrats!', kind: 'done' },
  ]
}

/**
 * Which column a task sits in.
 *
 * Takes no viewer: that is the point. Two people looking at the same board
 * cannot disagree, because there is nothing viewer-specific to disagree about.
 */
export function taskColumnId(task: TaskLike): string {
  if (task.completed) return DONE_COLUMN_ID
  return task.statusRole || INBOX_COLUMN_ID
}

/**
 * The task changes implied by dragging a card onto a column.
 *
 * Preserves the board invariants that the list model needed a server-side
 * normalizer to enforce: Done carries no status, and setting a status clears
 * completion.
 */
export function resolveColumnMove(
  task: TaskLike,
  targetColumnId: string
): { statusRole: string | null; completed: boolean } {
  if (targetColumnId === DONE_COLUMN_ID) return { statusRole: null, completed: true }
  if (targetColumnId === INBOX_COLUMN_ID) return { statusRole: null, completed: false }
  return { statusRole: targetColumnId, completed: false }
}

/** Is this role one a board can actually show? */
export function isKnownStatusRole(role: string | null | undefined, project?: ProjectLike | null): boolean {
  if (!role) return false
  if (DEFAULT_ROLES.has(role)) return true
  return parseCustomStates(project?.customStates).some(state => state.role === role)
}
