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
 * The three default roles, named so callers outside a board never spell them as
 * literals. The autonomous loops query `statusRole=ready` and write `doing` /
 * `waiting`, and a typo there is invisible: it returns an empty queue, which
 * reads exactly like a quiet day.
 */
export const READY_STATUS_ROLE = 'ready'
export const DOING_STATUS_ROLE = 'doing'
export const WAITING_STATUS_ROLE = 'waiting'

/**
 * The per-user defaults, as data rather than rows. Every board shows these.
 */
export const DEFAULT_STATES: readonly StatusState[] = [
  { role: READY_STATUS_ROLE, name: 'Ready', description: 'Time to get to work!', order: 0 },
  { role: DOING_STATUS_ROLE, name: 'Doing', description: 'Active work in progress!', order: 1 },
  { role: WAITING_STATUS_ROLE, name: 'Waiting', description: 'Paused until the circumstances are right.', order: 2 },
]

const DEFAULT_ROLES = new Set(DEFAULT_STATES.map(state => state.role))

/**
 * Is this a default role — one of the three every board shares?
 *
 * Exported so the custom-state writer has one place to ask. The default roles
 * are code constants, so "is it default" is a question about this file and not
 * about any row; asking a table would reintroduce the coupling AWTD-562 removed.
 */
export function isDefaultStatusRole(role: string | null | undefined): boolean {
  return !!role && DEFAULT_ROLES.has(role)
}

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
 * Custom states may also store per-board overrides for the three default roles
 * (ready/doing/waiting) — for example, a renamed built-in. Those entries are
 * returned alongside true custom states and distinguished by `isDefaultStatusRole`.
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
  const allCustomStates = parseCustomStates(project?.customStates)
  // Built-in overrides (renamed defaults) stored in customStates.
  const defaultOverrides = new Map(
    allCustomStates.filter(s => DEFAULT_ROLES.has(s.role)).map(s => [s.role, s]),
  )
  const customs = allCustomStates.filter(s => !DEFAULT_ROLES.has(s.role))

  return [
    { id: INBOX_COLUMN_ID, name: 'Inbox', description: 'Move them to "Ready" when they are... ready!', kind: 'inbox' },
    ...[...DEFAULT_STATES, ...customs].map<BoardColumn>(state => ({
      id: state.role,
      name: defaultOverrides.get(state.role)?.name ?? state.name,
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

/**
 * What completing or reopening a task does to its board lane (AWTD-964).
 *
 * Completing wrote `{ statusRole: null, completed: true }` and remembered
 * nothing, so a reopened task landed in Inbox — which the agent queue holds
 * out. Reopening a task from the phone therefore gave it to nobody, and
 * docs/FIXALL_WORKFLOW.md's claim that "a REOPENED task looks exactly like one
 * never done" was true of the document and false of the queue.
 *
 * THE LANE IS REMEMBERED, NOT RETAINED. Simply leaving `statusRole` set on a
 * done task would restore itself for free — `taskColumnId` checks `completed`
 * first, so the card still renders in Done — but a done task carrying a board
 * status violates an invariant the board depends on (task db7c6670), enforced
 * in two places in services/task.service.ts. So completion stashes the lane in
 * `statusRoleBeforeDone` and clears the live one; reopening moves it back and
 * empties the stash, so a later completion cannot resurrect a stale lane.
 *
 * Pure, and here rather than inline in the service, for the same reason
 * `resolveColumnMove` is: a rule inside `updateTaskWithSideEffects` is
 * reachable only through a live Postgres, which is how the missing half went
 * unnoticed in the first place.
 */
export function resolveCompletionStatusTransition(input: {
  /** `completed` as the request asked for it, or undefined if it said nothing. */
  requestedCompleted: boolean | undefined
  /** The lane the task is in right now. */
  currentStatusRole: string | null | undefined
  /** The lane stashed when it was completed, if any. */
  rememberedStatusRole: string | null | undefined
  /** Is this task assigned to an AI agent? Decides the no-memory landing lane. */
  assigneeIsAgent: boolean
}): { statusRole?: string | null; statusRoleBeforeDone?: string | null } {
  // An update that says nothing about completion must not move the card.
  if (input.requestedCompleted === undefined) return {}

  if (input.requestedCompleted) {
    return {
      statusRole: null,
      // A task completed twice (idempotent retry, sync backdating
      // completedAt, double PUT) has no live lane the second time — the
      // stash must keep the lane from the first completion, or the reopen
      // loses it.
      statusRoleBeforeDone: input.currentStatusRole ?? input.rememberedStatusRole ?? null,
    }
  }

  // The remembered lane wins over any default, and that matters most for
  // `waiting`: a task parked on a named condition must not come back as
  // actionable just because it passed through Done.
  if (input.rememberedStatusRole) {
    return { statusRole: input.rememberedStatusRole, statusRoleBeforeDone: null }
  }

  // Nothing remembered. For an AGENT's task that is every task completed
  // before this shipped, plus anything completed straight out of Inbox, and
  // reopening one means "do this again" — which is what Ready is. A person
  // reopening their own task has a board in front of them, so moving their
  // card for them would be presumptuous; it stays where it was.
  return {
    statusRole: input.assigneeIsAgent ? READY_STATUS_ROLE : null,
    statusRoleBeforeDone: null,
  }
}

/** Is this role one a board can actually show? */
export function isKnownStatusRole(role: string | null | undefined, project?: ProjectLike | null): boolean {
  if (!role) return false
  if (DEFAULT_ROLES.has(role)) return true
  return parseCustomStates(project?.customStates).some(state => state.role === role)
}
